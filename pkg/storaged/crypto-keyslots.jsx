/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";

import {
    Card, CardBody, CardTitle, CardHeader, CardActions,
    Checkbox, ClipboardCopy,
    Form, FormGroup,
    DataListItem, DataListItemRow, DataListItemCells, DataListCell, DataList,
    Text, TextVariants, TextInput as TextInputPF, Stack,
    Modal, Spinner, Button, Alert,
} from "@patternfly/react-core";
import { EditIcon, MinusIcon, PlusIcon, CheckCircleIcon, TimesCircleIcon } from "@patternfly/react-icons";

import sha1 from "js-sha1";
import sha256 from "js-sha256";
import stable_stringify from "json-stable-stringify-without-jsonify";
import { useDialogs, DialogsContext } from "dialogs.jsx";
import { useObject, useEvent } from "hooks";
import { check_missing_packages, install_missing_packages } from "packagekit";

import {
    dialog_open,
    SelectOneRadio, TextInput, PassInput, Skip
} from "./dialog.jsx";
import { array_find, decode_filename, encode_filename, block_name } from "./utils.js";
import { fmt_to_fragments } from "utils.jsx";
import { StorageButton } from "./storage-controls.jsx";
import { parse_options, unparse_options } from "./format-dialog.jsx";
import { edit_config } from "./crypto-tab.jsx";

import clevis_luks_passphrase_sh from "raw-loader!./clevis-luks-passphrase.sh";

const _ = cockpit.gettext;

/* Tang advertisement utilities
 */

function get_tang_adv(url) {
    return cockpit.spawn(["curl", "-sSf", url + "/adv"], { err: "message" })
            .then(JSON.parse)
            .catch(error => {
                return cockpit.reject(error.toString().replace(/^curl: \([0-9]+\) /, ""));
            });
}

function tang_adv_payload(adv) {
    return JSON.parse(cockpit.utf8_decoder().decode(cockpit.base64_decode(adv.payload)));
}

function jwk_b64_encode(bytes) {
    // Use the urlsafe character set, and strip the padding.
    return cockpit.base64_encode(bytes).replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, '');
}

function compute_thp(jwk) {
    const REQUIRED_ATTRS = {
        RSA: ['kty', 'p', 'd', 'q', 'dp', 'dq', 'qi', 'oth'],
        EC:  ['kty', 'crv', 'x', 'y'],
        oct: ['kty', 'k'],
    };

    if (!jwk.kty)
        return "(no key type attribute=";
    if (!REQUIRED_ATTRS[jwk.kty])
        return cockpit.format("(unknown keytype $0)", jwk.kty);

    const req = REQUIRED_ATTRS[jwk.kty];
    const norm = { };
    req.forEach(k => { if (k in jwk) norm[k] = jwk[k]; });
    return {
        sha256: jwk_b64_encode(sha256.digest(stable_stringify(norm))),
        sha1: jwk_b64_encode(sha1.digest(stable_stringify(norm)))
    };
}

function compute_sigkey_thps(adv) {
    function is_signing_key(jwk) {
        if (!jwk.use && !jwk.key_ops)
            return true;
        if (jwk.use == "sig")
            return true;
        if (jwk.key_ops && jwk.key_ops.indexOf("verify") >= 0)
            return true;
        return false;
    }

    return adv.keys.filter(is_signing_key).map(compute_thp);
}

/* Clevis operations
 */

function clevis_add(block, pin, cfg, passphrase) {
    const dev = decode_filename(block.Device);
    return cockpit.spawn(["clevis", "luks", "bind", "-f", "-k", "-", "-d", dev, pin, JSON.stringify(cfg)],
                         { superuser: true, err: "message" }).input(passphrase);
}

function clevis_remove(block, key) {
    // clevis-luks-unbind needs a tty on stdin for some reason.
    return cockpit.spawn(["clevis", "luks", "unbind", "-d", decode_filename(block.Device), "-s", key.slot, "-f"],
                         { superuser: true, pty: true, err: "message" });
}

export function clevis_recover_passphrase(block, just_type) {
    const dev = decode_filename(block.Device);
    const args = [];
    if (just_type)
        args.push("--type");
    args.push(dev);
    return cockpit.script(clevis_luks_passphrase_sh, args,
                          { superuser: true, err: "message" })
            .then(output => output.trim());
}

function clevis_unlock(block) {
    const dev = decode_filename(block.Device);
    const clear_dev = "luks-" + block.IdUUID;
    return cockpit.spawn(["clevis", "luks", "unlock", "-d", dev, "-n", clear_dev],
                         { superuser: true });
}

export function unlock_with_type(client, block, passphrase, passphrase_type) {
    const crypto = client.blocks_crypto[block.path];
    if (passphrase)
        return crypto.Unlock(passphrase, {});
    else if (passphrase_type == "stored")
        return crypto.Unlock("", {});
    else if (passphrase_type == "clevis")
        return clevis_unlock(block);
    else {
        // This should always be caught and should never show up in the UI
        return Promise.reject(new Error("No passphrase"));
    }
}

/* Passphrase operations
 */

function passphrase_add(block, new_passphrase, old_passphrase) {
    const dev = decode_filename(block.Device);
    return cockpit.spawn(["cryptsetup", "luksAddKey", dev],
                         { superuser: true, err: "message" }).input(old_passphrase + "\n" + new_passphrase);
}

function passphrase_change(block, key, new_passphrase, old_passphrase) {
    const dev = decode_filename(block.Device);
    return cockpit.spawn(["cryptsetup", "luksChangeKey", dev, "--key-slot", key.slot.toString()],
                         { superuser: true, err: "message" }).input(old_passphrase + "\n" + new_passphrase + "\n");
}

function slot_remove(block, slot, passphrase) {
    const dev = decode_filename(block.Device);
    const opts = { superuser: true, err: "message" };
    const cmd = ["cryptsetup", "luksKillSlot", dev, slot.toString()];
    if (passphrase === false) {
        cmd.splice(2, 0, "-q");
        opts.pty = true;
    }

    const spawn = cockpit.spawn(cmd, opts);
    if (passphrase !== false)
        spawn.input(passphrase + "\n");

    return spawn;
}

function passphrase_test(block, passphrase) {
    const dev = decode_filename(block.Device);
    return (cockpit.spawn(["cryptsetup", "luksOpen", "--test-passphrase", dev],
                          { superuser: true, err: "message" }).input(passphrase)
            .then(() => true)
            .catch(() => false));
}

/* Dialogs
 */

export function existing_passphrase_fields(explanation) {
    return [
        Skip("medskip", { visible: vals => vals.needs_explicit_passphrase }),
        PassInput("passphrase", _("Disk passphrase"),
                  {
                      visible: vals => vals.needs_explicit_passphrase,
                      validate: val => !val.length && _("Passphrase cannot be empty"),
                      explanation: explanation
                  })
    ];
}

function get_stored_passphrase(block, just_type) {
    const pub_config = array_find(block.Configuration, function (c) { return c[0] == "crypttab" });
    if (pub_config && pub_config[1]["passphrase-path"] && decode_filename(pub_config[1]["passphrase-path"].v) != "") {
        if (just_type)
            return Promise.resolve("stored");
        return block.GetSecretConfiguration({}).then(function (items) {
            for (let i = 0; i < items.length; i++) {
                if (items[i][0] == 'crypttab' && items[i][1]['passphrase-contents'])
                    return decode_filename(items[i][1]['passphrase-contents'].v);
            }
            return "";
        });
    }
}

export function get_existing_passphrase(block, just_type) {
    return clevis_recover_passphrase(block, just_type).then(passphrase => {
        return passphrase || get_stored_passphrase(block, just_type);
    });
}

export function request_passphrase_on_error_handler(dlg, vals, recovered_passphrase, block) {
    return function (error) {
        if (vals.passphrase === undefined) {
            return (passphrase_test(block, recovered_passphrase)
                    .then(good => {
                        if (!good)
                            dlg.set_values({ needs_explicit_passphrase: true });
                        return Promise.reject(error);
                    }));
        } else
            return Promise.reject(error);
    };
}

export function init_existing_passphrase(block, just_type, callback) {
    return {
        title: _("Unlocking disk"),
        func: dlg => {
            return get_existing_passphrase(block, just_type).then(passphrase => {
                if (!passphrase)
                    dlg.set_values({ needs_explicit_passphrase: true });
                if (callback)
                    callback(passphrase);
                return passphrase;
            });
        }
    };
}

function parse_url(url) {
    // clevis-encrypt-tang defaults to "http://" (via curl), so we do the same here.
    if (!/^[a-zA-Z]+:\/\//.test(url))
        url = "http://" + url;
    try {
        return new URL(url);
    } catch (e) {
        if (e instanceof TypeError)
            return null;
        throw e;
    }
}

function validate_url(url) {
    if (url.length === 0)
        return _("Address cannot be empty");
    if (!parse_url(url))
        return _("Address is not a valid URL");
}

let cur_Dialogs = null;

function add_dialog(client, block) {
    let recovered_passphrase;

    dialog_open({
        Title: _("Add key"),
        Fields: [
            SelectOneRadio("type", _("Key source"),
                           {
                               value: "tang",
                               visible: vals => client.features.clevis,
                               widest_title: _("Repeat passphrase"),
                               choices: [
                                   { value: "luks-passphrase", title: _("Passphrase") },
                                   { value: "tang", title: _("Tang keyserver") }
                               ]
                           }),
            Skip("medskip"),
            PassInput("new_passphrase", _("New passphrase"),
                      {
                          visible: vals => !client.features.clevis || vals.type == "luks-passphrase",
                          validate: val => !val.length && _("Passphrase cannot be empty"),
                      }),
            PassInput("new_passphrase2", _("Repeat passphrase"),
                      {
                          visible: vals => !client.features.clevis || vals.type == "luks-passphrase",
                          validate: (val, vals) => {
                              return (vals.new_passphrase.length &&
                                                        vals.new_passphrase != val &&
                                                        _("Passphrases do not match"));
                          }
                      }),
            TextInput("tang_url", _("Keyserver address"),
                      {
                          visible: vals => client.features.clevis && vals.type == "tang",
                          validate: validate_url
                      })
        ].concat(existing_passphrase_fields(_("Saving a new passphrase requires unlocking the disk. Please provide a current disk passphrase."))),
        Action: {
            Title: _("Add"),
            action: function (vals) {
                const existing_passphrase = vals.passphrase || recovered_passphrase;
                if (!client.features.clevis || vals.type == "luks-passphrase") {
                    return passphrase_add(block, vals.new_passphrase, existing_passphrase);
                } else {
                    return get_tang_adv(vals.tang_url).then(function (adv) {
                        edit_tang_adv(client, block, null,
                                      vals.tang_url, adv, existing_passphrase);
                    });
                }
            }
        },
        Inits: [
            init_existing_passphrase(block, false, pp => { recovered_passphrase = pp })
        ]
    });
}

function edit_passphrase_dialog(block, key) {
    dialog_open({
        Title: _("Change passphrase"),
        Fields: [
            PassInput("old_passphrase", _("Old passphrase"),
                      { validate: val => !val.length && _("Passphrase cannot be empty") }),
            Skip("medskip"),
            PassInput("new_passphrase", _("New passphrase"),
                      { validate: val => !val.length && _("Passphrase cannot be empty") }),
            PassInput("new_passphrase2", _("Repeat passphrase"),
                      { validate: (val, vals) => vals.new_passphrase.length && vals.new_passphrase != val && _("Passphrases do not match") })
        ],
        Action: {
            Title: _("Save"),
            action: vals => passphrase_change(block, key, vals.new_passphrase, vals.old_passphrase)
        }
    });
}

function edit_clevis_dialog(client, block, key) {
    let recovered_passphrase;

    dialog_open({
        Title: _("Edit Tang keyserver"),
        Fields: [
            TextInput("tang_url", _("Keyserver address"),
                      {
                          validate: validate_url,
                          value: key.url
                      })
        ].concat(existing_passphrase_fields(_("Saving a new passphrase requires unlocking the disk. Please provide a current disk passphrase."))),
        Action: {
            Title: _("Save"),
            action: function (vals) {
                const existing_passphrase = vals.passphrase || recovered_passphrase;
                return get_tang_adv(vals.tang_url).then(adv => {
                    edit_tang_adv(client, block, key, vals.tang_url, adv, existing_passphrase);
                });
            }
        },
        Inits: [
            init_existing_passphrase(block, false, pp => { recovered_passphrase = pp })
        ]
    });
}

function edit_tang_adv(client, block, key, url, adv, passphrase) {
    const parsed = parse_url(url);
    const cmd = cockpit.format("ssh $0 tang-show-keys $1", parsed.hostname, parsed.port);

    const sigkey_thps = compute_sigkey_thps(tang_adv_payload(adv));

    const dlg = dialog_open({
        Title: _("Verify key"),
        Body: (
            <>
                <p>{_("Make sure the key hash from the Tang server matches one of the following:")}</p>

                <h2 className="sigkey-heading">{_("SHA256")}</h2>
                { sigkey_thps.map(s => <p key={s} className="sigkey-hash">{s.sha256}</p>) }

                <h2 className="sigkey-heading">{_("SHA1")}</h2>
                { sigkey_thps.map(s => <p key={s} className="sigkey-hash">{s.sha1}</p>) }

                <p>
                    {_("Manually check with SSH: ")}
                    <ClipboardCopy hoverTip={_("Copy to clipboard")}
                                   clickTip={_("Successfully copied to clipboard!")}
                                   variant="inline-compact"
                                   isCode>
                        {cmd}
                    </ClipboardCopy>
                </p>
            </>
        ),
        Fields: existing_passphrase_fields(_("Saving a new passphrase requires unlocking the disk. Please provide a current disk passphrase.")),
        Action: {
            Title: _("Trust key"),
            action: function (vals) {
                return clevis_add(block, "tang", { url: url, adv: adv }, vals.passphrase || passphrase).then(() => {
                    if (key)
                        return clevis_remove(block, key);
                    else
                        cur_Dialogs.show(<CheckConfigNBDE client={client} block={block} />);
                })
                        .catch(request_passphrase_on_error_handler(dlg, vals, passphrase, block));
            }
        }
    });
}

const RemovePassphraseField = (tag, key, dev) => {
    function validate(val) {
        if (val === "")
            return _("Passphrase can not be empty");
    }

    return {
        tag: tag,
        title: null,
        options: { validate: validate },
        initial_value: "",
        bare: true,

        render: (val, change, validated, error) => {
            return (
                <Stack hasGutter>
                    <p>{ fmt_to_fragments(_("Passphrase removal may prevent unlocking $0."), <b>{dev}</b>) }</p>
                    <Form>
                        <Checkbox id="force-remove-passphrase"
                                  isChecked={val !== false}
                                  label={_("Confirm removal with an alternate passphrase")}
                                  onChange={checked => change(checked ? "" : false)}
                                  body={val === false
                                      ? <p className="slot-warning">
                                          {_("Removing a passphrase without confirmation of another passphrase may prevent unlocking or key management, if other passphrases are forgotten or lost.")}
                                      </p>
                                      : <FormGroup label={_("Passphrase from any other key slot")} fieldId="remove-passphrase">
                                          <TextInputPF id="remove-passphrase" type="password" value={val} onChange={value => change(value)} />
                                      </FormGroup>
                                  }
                        />
                    </Form>
                </Stack>
            );
        }
    };
};

function remove_passphrase_dialog(block, key) {
    dialog_open({
        Title: cockpit.format(_("Remove passphrase in key slot $0?"), key.slot),
        Fields: [
            RemovePassphraseField("passphrase", key, block_name(block))
        ],
        isFormHorizontal: false,
        Action: {
            DangerButton: true,
            Title: _("Remove"),
            action: function (vals) {
                return slot_remove(block, key.slot, vals.passphrase);
            }
        }
    });
}

const RemoveClevisField = (tag, key, dev) => {
    return {
        tag: tag,
        title: null,
        options: { },
        initial_value: "",
        bare: true,

        render: (val, change) => {
            return (
                <div data-field={tag}>
                    <p>{ fmt_to_fragments(_("Remove $0?"), <b>{key.url}</b>) }</p>
                    <p className="slot-warning">{ fmt_to_fragments(_("Keyserver removal may prevent unlocking $0."), <b>{dev}</b>) }</p>
                </div>
            );
        }
    };
};

function remove_clevis_dialog(client, block, key) {
    dialog_open({
        Title: _("Remove Tang keyserver?"),
        Fields: [
            RemoveClevisField("keyserver", key, block_name(block))
        ],
        Action: {
            DangerButton: true,
            Title: _("Remove"),
            action: function () {
                return clevis_remove(block, key);
            }
        }
    });
}

const Runner = (check_func) => {
    let cancel_func = null;

    function changed() {
        self.dispatchEvent("changed");
    }

    function set_cancel(func) {
        cancel_func = func;
    }

    function cancel() {
        if (cancel_func)
            cancel_func();
        self.cancelled = true;
    }

    function set_passed_text(text) {
        self.passed_text = text;
    }

    function add_check(text) {
        if (self.cancelled)
            throw new Error("cancelled");

        self.results.push({ running: true, passed: false, text: text });
        changed();
    }

    function passed() {
        const r = self.results[self.results.length - 1];
        r.running = false;
        r.passed = true;
        changed();
    }

    function failed(fix_func) {
        const r = self.results[self.results.length - 1];
        r.running = false;
        r.passed = false;
        r.fix_func = fix_func;
        changed();
    }

    function add_failure(text, fix_func) {
        self.results.splice(self.results.length - 1, 0, {
            running: false, passed: false, text: text,
            fix_func: fix_func
        });
        changed();
    }

    function start_checking(func) {
        self.results = [];
        self.needs_fixing = false;
        self.all_passed = false;
        self.error = null;
        self.status = "checking";
        changed();

        func(self)
                .catch(err => {
                    self.results.forEach(r => { r.running = false });
                    self.status = "failed";
                    self.error = err;
                })
                .then(() => {
                    if (!self.error) {
                        if (self.results.find(r => !r.passed))
                            self.status = "needs-fixing";
                        else
                            self.status = "passed";
                    }
                    changed();
                });
    }

    function start_fixing() {
        function fix(index) {
            while (index < self.results.length && self.results[index].passed)
                index++;

            if (index < self.results.length) {
                const r = self.results[index];
                r.running = true;
                r.fix_func(self)
                        .then(() => {
                            r.running = false;
                            r.passed = true;
                            fix(index + 1);
                        })
                        .catch(err => {
                            r.running = false;
                            r.passed = false;
                            self.status = "needs-fixing";
                            self.error = err;
                            changed();
                        });
                changed();
            } else {
                self.status = "passed";
                changed();
            }
        }
        self.status = "fixing";
        fix(0);
    }

    const self = {
        passed_text: null,
        results: [],
        error: null,
        cancelled: false,
        status: "idle",

        set_passed_text: set_passed_text,
        set_cancel: set_cancel,

        add_check: add_check,
        passed: passed,
        failed: failed,

        add_failure: add_failure,

        start_checking: start_checking,
        start_fixing: start_fixing,
        can_cancel: () => self.status != "fixing" || !!cancel_func,
        cancel: cancel
    };

    cockpit.event_target(self);

    if (check_func)
        self.start_checking(check_func);

    return self;
};

const ResultIcon = ({ runner, result }) => {
    if (result.running)
        return <Spinner isSVG size="md" />;
    else if (result.passed)
        return <CheckCircleIcon className="ct-icon-check-circle" />;
    else
        return <TimesCircleIcon className="ct-icon-times-circle" />;
};

const CheckConfig = ({ check_func }) => {
    const Dialogs = useDialogs();
    const runner = useObject(() => Runner(check_func),
                             runner => runner.cancel(),
                             []);
    useEvent(runner, "changed");

    const actions = [];

    if (runner.status == "needs-fixing" || runner.status == "fixing")
        actions.push(
            <Button key="fix" variant="primary" onClick={() => runner.start_fixing()}
                    isDisabled={runner.status == "fixing"}>
                {_("Fix")}
            </Button>);

    actions.push(
        <Button key="cancel" variant="link" onClick={Dialogs.close}
                disabled={!runner.can_cancel()}>
            {_("Close")}
        </Button>);

    return (
        <Modal id="dialog"
               title={_("Checking system configuration")}
               position="top" variant="medium"
               isOpen
               actions={actions}
               onClose={Dialogs.close}>
            { runner.error ? <Alert variant='danger' isInline title={runner.error.toString()} /> : null }
            { runner.results.map((r, i) =>
                <div key={i}>
                    <ResultIcon runner={runner} result={r} /> {"\n"} {r.text}
                </div>)
            }
            { runner.status == "passed" && runner.passed_text
                ? <div><br />{runner.passed_text}</div>
                : null
            }
        </Modal>);
};

function check_installed_package(runner, name) {
    runner.add_check(cockpit.format(_("The $0 package must be installed."), name));
    return check_missing_packages([name], status => runner.set_cancel(status.cancel))
            .then(data => {
                runner.set_cancel(null);
                if (data.missing_names.length + data.unavailable_names.length == 0)
                    runner.passed();
                else
                    runner.failed(() => {
                        if (data.unavailable_names.length == 0)
                            return install_missing_packages(data, status => runner.set_cancel(status.cancel));
                        else
                            return Promise.reject(cockpit.format(_("The $0 package is not available from any repository."), name));
                    });
            });
}

function maybe_add_missing_package_failure(runner, name) {
    return check_missing_packages([name], status => runner.set_cancel(status.cancel))
            .then(data => {
                runner.set_cancel(null);
                if (data.missing_names.length + data.unavailable_names.length > 0)
                    runner.add_failure(cockpit.format(_("The $0 package must be installed."), name),
                                       () => {
                                           if (data.unavailable_names.length == 0)
                                               return install_missing_packages(data, status => runner.set_cancel(status.cancel));
                                           else
                                               return Promise.reject(cockpit.format(_("The $0 package is not available from any repository."), name));
                                       });
            });
}

function check_enabled_unit(runner, name, package_name) {
    runner.add_check(cockpit.format(_("The $0 unit must be enabled."), name));
    return cockpit.spawn(["systemctl", "is-enabled", name], { err: "message" })
            .then(() => runner.passed())
            .catch((err, output) => {
                function failed() {
                    runner.failed(() => cockpit.spawn(["systemctl", "enable", "--now", name],
                                                      { superuser: true, err: "message" }));
                    return Promise.resolve();
                }
                if (err && output == "" && package_name)
                    return maybe_add_missing_package_failure(runner, package_name).then(failed);
                else
                    return failed();
            });
}

function check_initrd_clevis_support(runner) {
    runner.add_check(_("The initrd must include support for Clevis."));
    const task = cockpit.spawn(["lsinitrd"], { superuser: true });
    runner.set_cancel(() => task.close());
    return task.then(data => {
        runner.set_cancel(null);
        if (data.indexOf("clevis") >= 0)
            runner.passed();
        else
            runner.failed(() => {
                const task = cockpit.spawn(["dracut", "--force", "--regenerate-all"],
                                           { superuser: true, err: "message" });
                runner.set_cancel(() => task.close());
                return task;
            });
    });
}

function check_kernel_cmdline(runner, arg) {
    runner.add_check(cockpit.format(_("The kernel command line must include \"$0\"."), arg));
    return cockpit.file("/etc/kernel/cmdline").read().then(data => {
        const args = data.trim().split(" ");
        if (args.indexOf(arg) >= 0)
            runner.passed();
        else
            runner.failed(() => cockpit.spawn(["grubby", "--update-kernel=ALL", "--args=" + arg],
                                              { superuser: true, err: "message" }));
    });
}

function check_fstab_option(runner, client, block, option) {
    runner.add_check(cockpit.format(_("The mounting options must include \"$0\"."), option));

    const cleartext = client.blocks_cleartext[block.path];
    const crypto = client.blocks_crypto[block.path];
    const fsys_config = (cleartext
        ? array_find(cleartext.Configuration, function (c) { return c[0] == "fstab" })
        : array_find(crypto.ChildConfiguration, function (c) { return c[0] == "fstab" }));
    const fsys_options = fsys_config && parse_options(decode_filename(fsys_config[1].opts.v));

    if (!fsys_options || fsys_options.indexOf(option) >= 0)
        runner.passed();
    else
        runner.failed(() => {
            const new_fsys_options = fsys_options.concat([option]);
            const new_fsys_config = [
                "fstab",
                Object.assign({ }, fsys_config[1],
                              {
                                  opts: {
                                      t: 'ay',
                                      v: encode_filename(unparse_options(new_fsys_options))
                                  }
                              })
            ];
            return block.UpdateConfigurationItem(fsys_config, new_fsys_config, { });
        });

    return Promise.resolve();
}

function check_crypttab_option(runner, client, block, option) {
    runner.add_check(cockpit.format(_("The encryption options must include \"$0\"."), option));

    const crypto_config = array_find(block.Configuration, function (c) { return c[0] == "crypttab" });
    const crypto_options = crypto_config && parse_options(decode_filename(crypto_config[1].options.v));
    if (!crypto_options || crypto_options.indexOf(option) >= 0)
        runner.passed();
    else
        runner.failed(() => {
            const new_crypto_options = crypto_options.concat([option]);
            return edit_config(block, (config, commit) => {
                config.options = { t: 'ay', v: encode_filename(unparse_options(new_crypto_options)) };
                return commit();
            });
        });

    return Promise.resolve();
}

const CheckConfigNBDE = ({ client, block }) => {
    function check_func(runner) {
        const cleartext = client.blocks_cleartext[block.path];
        const crypto = client.blocks_crypto[block.path];
        const fsys_config = (cleartext
            ? array_find(cleartext.Configuration, function (c) { return c[0] == "fstab" })
            : array_find(crypto.ChildConfiguration, function (c) { return c[0] == "fstab" }));
        const dir = decode_filename(fsys_config[1].dir.v);

        if (dir == "/") {
            runner.set_passed_text(_("The system is configured correctly for Network Bound Disk Encryption of the root filesystem."));
            /* The clevis-dracut package needs to be installed even when
             * the current initrd contains support for Clevis.  Otherwise,
             * support will disappear on the next regeneration.
             */
            return Promise.resolve()
                    .then(() => check_installed_package(runner, "clevis-dracut"))
                    .then(() => check_initrd_clevis_support(runner))
                    .then(() => check_kernel_cmdline(runner, "rd.neednet=1"));
        } else {
            runner.set_passed_text(cockpit.format(_("The system is configured correctly for Network Bound Disk Encryption of $0."), block_name(block)));
            return Promise.resolve()
                    .then(() => check_fstab_option(runner, client, block, "_netdev"))
                    .then(() => check_crypttab_option(runner, client, block, "_netdev"))
                    .then(() => check_enabled_unit(runner, "remote-cryptsetup.target"))
                    .then(() => check_enabled_unit(runner, "clevis-luks-askpass.path", "clevis-systemd"));
        }
    }

    return <CheckConfig check_func={check_func} />;
};

export class CryptoKeyslots extends React.Component {
    static contextType = DialogsContext;

    render() {
        const Dialogs = this.context;
        const { client, block, slots, slot_error, max_slots } = this.props;

        if ((slots == null && slot_error == null) || slot_error == "not-found")
            return null;

        function decode_clevis_slot(slot) {
            if (slot.ClevisConfig) {
                const clevis = JSON.parse(slot.ClevisConfig.v);
                if (clevis.pin && clevis.pin == "tang" && clevis.tang) {
                    return {
                        slot: slot.Index.v,
                        type: "tang",
                        url: clevis.tang.url
                    };
                } else {
                    return {
                        slot: slot.Index.v,
                        type: "unknown",
                        pin: clevis.pin
                    };
                }
            } else {
                return {
                    slot: slot.Index.v,
                    type: "luks-passphrase"
                };
            }
        }

        const keys = slots ? slots.map(decode_clevis_slot).filter(k => !!k) : [];

        let rows;
        if (keys.length == 0) {
            let text;
            if (slot_error) {
                if (slot_error.problem == "access-denied")
                    text = _("The currently logged in user is not permitted to see information about keys.");
                else
                    text = slot_error.toString();
            } else {
                text = _("No keys added");
            }
            rows = <tr><td className="text-center">{text}</td></tr>;
        } else {
            rows = [];

            const add_row = (slot, type, desc, edit, edit_excuse, remove) => {
                rows.push(
                    <DataListItem key={slot}>
                        <DataListItemRow>
                            <DataListItemCells
                                dataListCells={[
                                    <DataListCell key="key-type">
                                        { type }
                                    </DataListCell>,
                                    <DataListCell key="desc" isFilled={false}>
                                        { desc }
                                    </DataListCell>,
                                    <DataListCell key="key-slot">
                                        { cockpit.format(_("Slot $0"), slot) }
                                    </DataListCell>,
                                    <DataListCell key="text-right" isFilled={false} alignRight>
                                        <StorageButton onClick={edit}
                                                       ariaLabel={_("Edit")}
                                                       excuse={(keys.length == max_slots)
                                                           ? _("Editing a key requires a free slot")
                                                           : null}>
                                            <EditIcon />
                                        </StorageButton>
                                        { "\n" }
                                        <StorageButton onClick={remove}
                                                       ariaLabel={_("Remove")}
                                                       excuse={keys.length == 1 ? _("The last key slot can not be removed") : null}>
                                            <MinusIcon />
                                        </StorageButton>
                                    </DataListCell>,
                                ]}
                            />
                        </DataListItemRow>
                    </DataListItem>
                );
            };

            keys.sort((a, b) => a.slot - b.slot).forEach(key => {
                if (key.type == "luks-passphrase") {
                    add_row(key.slot,
                            _("Passphrase"), "",
                            () => edit_passphrase_dialog(block, key), null,
                            () => remove_passphrase_dialog(block, key));
                } else if (key.type == "tang") {
                    add_row(key.slot,
                            _("Keyserver"), key.url,
                            () => edit_clevis_dialog(client, block, key), null,
                            () => remove_clevis_dialog(client, block, key));
                } else {
                    add_row(key.slot,
                            _("Unknown type"), "",
                            null, _("Key slots with unknown types can not be edited here"),
                            () => remove_clevis_dialog(client, block, key));
                }
            });
        }

        const remaining = max_slots - keys.length;

        function check_config() {
            Dialogs.show(<CheckConfigNBDE client={client} block={block} />);
        }

        return (
            <Card className="key-slot-panel">
                <CardHeader>
                    <CardActions>
                        <StorageButton kind="link" onClick={check_config}>
                            {_("Check system configuration for Network Bound Disk Encryption support")}
                        </StorageButton>
                        <span className="key-slot-panel-remaining">
                            { remaining < 6 ? (remaining ? cockpit.format(cockpit.ngettext("$0 slot remains", "$0 slots remain", remaining), remaining) : _("No available slots")) : null }
                        </span>
                        <StorageButton onClick={() => { cur_Dialogs = Dialogs; add_dialog(client, block) }}
                                       ariaLabel={_("Add")}
                                       excuse={(keys.length == max_slots)
                                           ? _("No free key slots")
                                           : null}>
                            <PlusIcon />
                        </StorageButton>
                    </CardActions>
                    <CardTitle><Text component={TextVariants.h2}>{_("Keys")}</Text></CardTitle>
                </CardHeader>
                <CardBody className="contains-list">
                    <DataList isCompact className="crypto-keyslots-list" aria-label={_("Keys")}>
                        {rows}
                    </DataList>
                </CardBody>
            </Card>
        );
    }
}
