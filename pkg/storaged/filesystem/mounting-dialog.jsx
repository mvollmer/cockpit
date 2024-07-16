/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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
import client from "../client.js";

import { FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { HelperText, HelperTextItem, } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { ExclamationTriangleIcon, InfoCircleIcon } from "@patternfly/react-icons";

import {
    encode_filename,
    parse_options, unparse_options, extract_option, reload_systemd,
    is_mounted_synch,
    get_active_usage, teardown_active_usage,
    set_crypto_auto_option,
    maybe_update_crypto_options,
} from "../utils.js";

import {
    dialog_open,
    TextInput, PassInput, CheckBoxes, SelectOne,
    TeardownMessage,
    init_teardown_usage
} from "../dialog.jsx";
import { init_existing_passphrase, unlock_with_type } from "../crypto/keyslots.jsx";
import { initial_tab_options } from "../block/format-dialog.jsx";
import { is_probably_single_device_btrfs_volume } from "../btrfs/utils.jsx";

import {
    is_mounted, get_fstab_config,
    is_valid_mount_point
} from "./utils.jsx";

const _ = cockpit.gettext;

export const mount_options = (opt_ro, extra_options, is_visible, force_ro) => {
    return CheckBoxes("mount_options", _("Mount options"),
                      {
                          visible: vals => !client.in_anaconda_mode() && (!is_visible || is_visible(vals)),
                          value: {
                              ro: opt_ro || force_ro,
                              extra: extra_options || false
                          },
                          fields: [
                              {
                                  title: _("Mount read only"),
                                  tag: "ro",
                                  disabled: force_ro,
                                  tooltip: force_ro && _("This subvolume can only be mounted read-only right now. To mount it read-write, unmount all other subvolumes first.")
                              },
                              { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                          ]
                      });
};

export const mount_explanation = {
    local:
    <FormHelperText>
        <HelperText>
            <HelperTextItem hasIcon>
                {_("Mounts before services start")}
            </HelperTextItem>
            <HelperTextItem hasIcon>
                {_("Appropriate for critical mounts, such as /var")}
            </HelperTextItem>
            <HelperTextItem hasIcon icon={<ExclamationTriangleIcon className="ct-icon-exclamation-triangle" />}>
                {_("Boot fails if filesystem does not mount, preventing remote access")}
            </HelperTextItem>
        </HelperText>
    </FormHelperText>,
    nofail:
    <FormHelperText>
        <HelperText>
            <HelperTextItem hasIcon>
                {_("Mounts in parallel with services")}
            </HelperTextItem>
            <HelperTextItem hasIcon icon={<InfoCircleIcon className="ct-icon-info-circle" />}>
                {_("Boot still succeeds when filesystem does not mount")}
            </HelperTextItem>
        </HelperText>
    </FormHelperText>,
    netdev:
    <FormHelperText>
        <HelperText>
            <HelperTextItem hasIcon>
                {_("Mounts in parallel with services, but after network is available")}
            </HelperTextItem>
            <HelperTextItem hasIcon icon={<InfoCircleIcon className="ct-icon-info-circle" />}>
                {_("Boot still succeeds when filesystem does not mount")}
            </HelperTextItem>
        </HelperText>
    </FormHelperText>,
    never:
    <FormHelperText>
        <HelperText>
            <HelperTextItem hasIcon>
                {_("Does not mount during boot")}
            </HelperTextItem>
            <HelperTextItem hasIcon>
                {_("Useful for mounts that are optional or need interaction (such as passphrases)")}
            </HelperTextItem>
        </HelperText>
    </FormHelperText>,
};

export const at_boot_input = (at_boot, is_visible) => {
    const init = at_boot || (client.in_anaconda_mode() ? "local" : "nofail");
    return SelectOne("at_boot", _("At boot"),
                     {
                         visible: vals => !client.in_anaconda_mode() && (!is_visible || is_visible(vals)),
                         value: init,
                         explanation: mount_explanation[init],
                         choices: [
                             {
                                 value: "local",
                                 title: _("Mount before services start"),
                             },
                             {
                                 value: "nofail",
                                 title: _("Mount without waiting, ignore failure"),
                             },
                             {
                                 value: "netdev",
                                 title: _("Mount after network becomes available, ignore failure"),
                             },
                             {
                                 value: "never",
                                 title: _("Do not mount"),
                             },
                         ]
                     });
};

export function update_at_boot_input(dlg, vals, trigger) {
    if (trigger == "at_boot")
        dlg.set_options("at_boot", { explanation: mount_explanation[vals.at_boot] });
}

export function mounting_dialog(client, block, mode, forced_options, subvol, subvols) {
    const block_fsys = client.blocks_fsys[block.path];
    const [old_config, old_dir, old_opts, old_parents] = get_fstab_config(block, true, subvol);
    const options = old_config ? old_opts : initial_tab_options(client, block, true);

    const old_dir_for_display = client.strip_mount_point_prefix(old_dir);
    if (old_dir_for_display === false)
        return Promise.reject(_("This device can not be used for the installation target."));

    const split_options = parse_options(options);
    extract_option(split_options, "noauto");
    const opt_never_auto = extract_option(split_options, "x-cockpit-never-auto");
    const opt_ro = extract_option(split_options, "ro");
    const opt_nofail = extract_option(split_options, "nofail");
    const opt_netdev = extract_option(split_options, "_netdev");
    if (forced_options)
        for (const opt of forced_options)
            extract_option(split_options, opt);
    const extra_options = unparse_options(split_options);

    const is_filesystem_mounted = is_mounted(client, block, subvol);

    function maybe_update_config(new_dir, new_opts, passphrase, passphrase_type, crypto_unlock_readonly) {
        let new_config = null;
        let all_new_opts;

        if (new_opts && old_parents)
            all_new_opts = new_opts + "," + old_parents;
        else if (new_opts)
            all_new_opts = new_opts;
        else
            all_new_opts = old_parents;

        if (new_dir != "") {
            if (new_dir[0] != "/")
                new_dir = "/" + new_dir;
            new_config = [
                "fstab", {
                    fsname: old_config ? old_config[1].fsname : undefined,
                    dir: { t: 'ay', v: encode_filename(new_dir) },
                    type: { t: 'ay', v: encode_filename("auto") },
                    opts: { t: 'ay', v: encode_filename(all_new_opts || "defaults") },
                    freq: { t: 'i', v: 0 },
                    passno: { t: 'i', v: 0 },
                    "track-parents": { t: 'b', v: !old_config }
                }];
        }

        function undo() {
            if (!old_config && new_config)
                return block.RemoveConfigurationItem(new_config, {});
            else if (old_config && !new_config)
                return block.AddConfigurationItem(old_config, {});
            else if (old_config && new_config && (new_dir != old_dir || new_opts != old_opts)) {
                return block.UpdateConfigurationItem(new_config, old_config, {});
            }
        }

        function get_block_fsys() {
            if (block_fsys)
                return Promise.resolve(block_fsys);
            else
                return client.wait_for(() => (client.blocks_cleartext[block.path] &&
                                              client.blocks_fsys[client.blocks_cleartext[block.path].path]));
        }

        function maybe_mount() {
            if (mode == "mount" || (mode == "update" && is_filesystem_mounted)) {
                return (get_block_fsys()
                        .then(block_fsys => {
                            const block = client.blocks[block_fsys.path];
                            return (client.mount_at(block, new_dir)
                                    .catch(error => {
                                        // systemd might have mounted the filesystem for us after
                                        // unlocking, because fstab told it to.  Ignore any error
                                        // from mounting in that case.  This only happens when this
                                        // code runs to fix a inconsistent mount.
                                        return (is_mounted_synch(block)
                                                .then(mounted_at => {
                                                    if (mounted_at == new_dir)
                                                        return;
                                                    return (undo()
                                                            .then(() => {
                                                                if (is_filesystem_mounted)
                                                                    return client.mount_at(block, old_dir);
                                                            })
                                                            .catch(ignored_error => {
                                                                console.warn("Error during undo:", ignored_error);
                                                            })
                                                            .then(() => Promise.reject(error)));
                                                }));
                                    }));
                        }));
            } else
                return Promise.resolve();
        }

        async function maybe_unlock() {
            if (mode == "mount" || (mode == "update" && is_filesystem_mounted)) {
                let crypto = client.blocks_crypto[block.path];
                const backing = client.blocks[block.CryptoBackingDevice];

                if (backing && block.ReadOnly != crypto_unlock_readonly) {
                    // We are working on a open crypto device, but it
                    // has the wrong readonly-ness. Close it so that we can reopen it below.
                    crypto = client.blocks_crypto[backing.path];
                    await crypto.Lock({});
                }

                if (crypto) {
                    try {
                        await unlock_with_type(client, client.blocks[crypto.path],
                                               passphrase, passphrase_type, crypto_unlock_readonly);
                        // Check whether we have just opened a
                        // multi-device btrfs volume. If so, we need to
                        // give up.
                        //
                        // Ideally, Cockpit would always know when
                        // something is part of a multi-device btrfs
                        // volume, even for locked LUKS devices, and would
                        // never let people mount subvolumes of such a
                        // volume unless all devices are available.
                        //
                        // But that knowledge is based on the "x-parent"
                        // options in /etc/fstab, and those are
                        // unreliable.
                        //
                        // Thus, while we should try to not let the user
                        // run into this situation here as much as
                        // possible, we will probably not be able to rule
                        // it out completely.
                        const cleartext = await client.wait_for(() => client.blocks_cleartext[crypto.path]);
                        if (cleartext.IdType == "btrfs" && client.features.btrfs) {
                            const btrfs = await client.wait_for(() => client.blocks_fsys_btrfs[cleartext.path]);
                            if (btrfs.data.num_devices > 1) {
                                await set_crypto_auto_option(block, true);
                                throw new Error("unexpected-multi-device-btrfs");
                            }
                        }
                        return cleartext;
                    } catch (error) {
                        passphrase_type = null;
                        dlg.set_values({ needs_explicit_passphrase: true });
                        throw error;
                    }
                }
            }

            return block;
        }

        // We need to reload systemd twice: Once at the beginning so
        // that it is up to date with whatever is currently in fstab,
        // and once at the end to make it see our changes.  Otherwise
        // systemd might do some uexpected mounts/unmounts behind our
        // backs.

        return (reload_systemd()
                .then(() => teardown_active_usage(client, usage))
                .then(maybe_unlock)
                .then(content_block => {
                    if (!old_config && new_config)
                        return (content_block.AddConfigurationItem(new_config, {})
                                .then(maybe_mount));
                    else if (old_config && !new_config)
                        return content_block.RemoveConfigurationItem(old_config, {});
                    else if (old_config && new_config)
                        return (content_block.UpdateConfigurationItem(old_config, new_config, {})
                                .then(maybe_mount));
                    else if (new_config && !is_mounted(client, block))
                        return maybe_mount();
                })
                .then(reload_systemd));
    }

    let at_boot;
    if (opt_never_auto)
        at_boot = "never";
    else if (opt_netdev)
        at_boot = "netdev";
    else if (opt_nofail)
        at_boot = "nofail";
    else
        at_boot = "local";

    let need_rw_backing = false;
    let backing_is_busy = false;
    if (subvol) {
        for (const sv of subvols) {
            if (sv.pathname != subvol.pathname) {
                const [, , opts] = get_fstab_config(block, false, sv);
                if (opts) {
                    const opt_ro = extract_option(parse_options(opts), "ro");
                    if (!opt_ro)
                        need_rw_backing = true;
                }
                if (is_mounted(client, block, sv))
                    backing_is_busy = true;
            }
        }
    }

    // If LUKS is open as read-only and is kept busy by other mounts,
    // we can't change it to read-write.

    const force_ro = client.blocks[block.CryptoBackingDevice] && block.ReadOnly && backing_is_busy;

    let fields = null;
    if (mode == "mount" || mode == "update") {
        fields = [
            TextInput("mount_point", _("Mount point"),
                      {
                          value: old_dir_for_display,
                          validate: val => is_valid_mount_point(client,
                                                                block,
                                                                client.add_mount_point_prefix(val),
                                                                mode == "update" && !is_filesystem_mounted,
                                                                mode == "update",
                                                                subvol)
                      }),
            mount_options(opt_ro, extra_options, null, force_ro),
            at_boot_input(at_boot),
        ];

        fields = fields.concat([
            PassInput("passphrase", _("Passphrase"),
                      {
                          visible: vals => vals.needs_explicit_passphrase,
                          validate: val => !val.length && _("Passphrase cannot be empty"),
                      })
        ]);
    }

    const mode_title = {
        mount: _("Mount filesystem"),
        unmount: _("Unmount filesystem $0"),
        update: _("Mount configuration")
    };

    const mode_action = {
        mount: _("Mount"),
        unmount: _("Unmount"),
        update: _("Save")
    };

    function maybe_lock() {
        const block_fsys = client.blocks_fsys[block.path];
        const crypto_backing = client.blocks[block.CryptoBackingDevice];
        const crypto_backing_crypto = crypto_backing && client.blocks_crypto[crypto_backing.path];
        if (crypto_backing_crypto && block_fsys && block_fsys.MountPoints.length == 0 && !client.in_anaconda_mode()) {
            return crypto_backing_crypto.Lock({});
        } else
            return Promise.resolve();
    }

    async function do_unmount() {
        let opts = [];
        opts.push("noauto");
        if (opt_ro)
            opts.push("ro");
        if (opt_never_auto)
            opts.push("x-cockpit-never-auto");
        if (opt_nofail)
            opts.push("nofail");
        if (opt_netdev)
            opts.push("_netdev");
        if (forced_options)
            opts = opts.concat(forced_options);
        if (extra_options)
            opts = opts.concat(extra_options);

        await maybe_update_config(old_dir, unparse_options(opts));
        if (is_probably_single_device_btrfs_volume(block)) {
            await maybe_update_crypto_options(client, block);
            await maybe_lock();
        }
    }

    let passphrase_type;

    const usage = get_active_usage(client, block.path, null, null, false, subvol);

    function desired_crypto_readonly(vals_ro) {
        // If LUKS is busy, we can't Lock and Unlock it, so don't try
        // to make it read-only, even if that would be the correct
        // thing to do.
        if (client.blocks[block.CryptoBackingDevice] && !block.ReadOnly && backing_is_busy)
            return false;
        return !need_rw_backing && vals_ro;
    }

    function update_explicit_passphrase(vals_ro) {
        const backing = client.blocks[block.CryptoBackingDevice];
        let need_passphrase = (block.IdUsage == "crypto" && mode == "mount");
        if (backing) {
            if (block.ReadOnly != desired_crypto_readonly(vals_ro))
                need_passphrase = true;
        }
        dlg.set_values({ needs_explicit_passphrase: need_passphrase && !passphrase_type });
    }

    const dlg = dialog_open({
        Title: cockpit.format(mode_title[mode], old_dir_for_display),
        Fields: fields,
        Teardown: TeardownMessage(usage, old_dir || true),
        update: function (dlg, vals, trigger) {
            update_at_boot_input(dlg, vals, trigger);
            if (trigger == "mount_options")
                update_explicit_passphrase(vals.mount_options.ro);
        },
        Action: {
            Title: mode_action[mode],
            disable_on_error: usage.Teardown,
            action: async function (vals) {
                if (mode == "unmount") {
                    await do_unmount();
                } else if (mode == "mount" || mode == "update") {
                    let opts = [];
                    if ((mode == "update" && !is_filesystem_mounted) || vals.at_boot == "never")
                        opts.push("noauto");
                    if (vals.mount_options?.ro)
                        opts.push("ro");
                    if (vals.at_boot == "never")
                        opts.push("x-cockpit-never-auto");
                    if (vals.at_boot == "nofail")
                        opts.push("nofail");
                    if (vals.at_boot == "netdev")
                        opts.push("_netdev");
                    if (forced_options)
                        opts = opts.concat(forced_options);
                    if (vals.mount_options?.extra)
                        opts = opts.concat(parse_options(vals.mount_options.extra));
                    const crypto_unlock_readonly = desired_crypto_readonly(vals.mount_options?.ro ?? opt_ro);
                    try {
                        await maybe_update_config(client.add_mount_point_prefix(vals.mount_point),
                                                  unparse_options(opts),
                                                  vals.passphrase,
                                                  passphrase_type,
                                                  crypto_unlock_readonly);
                        if (is_probably_single_device_btrfs_volume(block))
                            await maybe_update_crypto_options(client, block);
                    } catch (error) {
                        if (error.message == "unexpected-multi-device-btrfs") {
                            dialog_open({
                                Title: _("Multi-device btrfs volume detected"),
                                Body: <p>{_("This device is only part of a btrfs volume. Please make all devices available in order to mount it.")}</p>
                            });
                        } else
                            throw error;
                    }
                }
            }
        },
        Inits: [
            init_teardown_usage(client, usage, old_dir || true),
            init_existing_passphrase(block, true, type => {
                passphrase_type = type;
                update_explicit_passphrase(dlg.get_value("mount_options")?.ro ?? opt_ro);
            }),
        ]
    });
}
