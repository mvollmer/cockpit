/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
import * as utils from "./utils.js";

import {
    dialog_open,
    TextInput, PassInput, CheckBoxes, SelectOne, SizeSlider,
    BlockingMessage, TeardownMessage
} from "./dialog.jsx";

const _ = cockpit.gettext;

export function parse_options(options) {
    if (options)
        return (options.split(",")
                .map(function (s) { return s.trim() })
                .filter(function (s) { return s != "" }));
    else
        return [];
}

export function unparse_options(split) {
    return split.join(",");
}

export function extract_option(split, opt) {
    var index = split.indexOf(opt);
    if (index >= 0) {
        split.splice(index, 1);
        return true;
    } else {
        return false;
    }
}

export function mounting_dialog_fields(is_custom, mount_dir, mount_options, visible, for_unmount) {
    if (for_unmount)
        visible = () => false;
    else if (!visible)
        visible = function () { return true };

    var split_options = parse_options(mount_options == "defaults" ? "" : mount_options);
    extract_option(split_options, "noauto");
    var opt_ro = extract_option(split_options, "ro");
    var extra_options = unparse_options(split_options);

    return [
        TextInput("mount_point", _("Mount Point"),
                  {
                      value: mount_dir,
                      visible: visible,
                      validate: function (val) {
                          if (val === "")
                              return _("Mount point cannot be empty");
                      }
                  }),
        CheckBoxes("mount_options", _("Mount Options"),
                   {
                       visible: visible,
                       value: {
                           auto: !for_unmount,
                           ro: opt_ro,
                           extra: extra_options === "" ? false : extra_options
                       },
                       fields: [
                           { title: _("Mount read only"), tag: "ro" },
                           { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                       ]
                   },
        ),
    ];
}

export function mounting_dialog_options(vals) {
    var opts = [];
    if (!vals.mount_options || !vals.mount_options.auto)
        opts.push("noauto");
    if (vals.mount_options && vals.mount_options.ro)
        opts.push("ro");
    if (vals.mount_options && vals.mount_options.extra !== false)
        opts = opts.concat(parse_options(vals.mount_options.extra));
    return unparse_options(opts);
}

export function crypto_options_dialog_fields(options, visible, include_store_passphrase) {
    var split_options = parse_options(options);
    var opt_auto = !extract_option(split_options, "noauto");
    var opt_ro = extract_option(split_options, "readonly");
    var extra_options = unparse_options(split_options);

    var fields = [
        { title: _("Unlock at boot"), tag: "auto" },
        { title: _("Unlock read only"), tag: "ro" },
        { title: _("Custom encryption options"), tag: "extra", type: "checkboxWithInput" },
    ];

    if (include_store_passphrase)
        fields = [{ title: _("Store passphrase"), tag: "store_passphrase" }].concat(fields);

    return [
        CheckBoxes("crypto_options", "",
                   {
                       visible: visible,
                       value: {
                           auto: opt_auto,
                           ro: opt_ro,
                           extra: extra_options === "" ? false : extra_options
                       },
                       fields: fields
                   },
        ),
    ];
}

export function crypto_options_dialog_options(vals) {
    var opts = [];
    if (!vals.crypto_options || !vals.crypto_options.auto)
        opts.push("noauto");
    if (vals.crypto_options && vals.crypto_options.ro)
        opts.push("readonly");
    if (vals.crypto_options && vals.crypto_options.extra !== false)
        opts = opts.concat(parse_options(vals.crypto_options.extra));
    return unparse_options(opts);
}

export function initial_tab_options(client, block, for_fstab) {
    var options = { };

    utils.get_parent_blocks(client, block.path).forEach(p => {
        if (utils.is_netdev(client, p)) {
            options._netdev = true;
        }
        // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1589541
        if (client.vdo_overlay.find_by_block(client.blocks[p])) {
            options._netdev = true;
            options["x-systemd.device-timeout=0"] = true;
            if (for_fstab)
                options["x-systemd.requires=vdo.service"] = true;
        }
    });

    return Object.keys(options).join(",");
}

export function initial_crypto_options(client, block) {
    return initial_tab_options(client, block, false);
}

export function initial_mount_options(client, block) {
    return initial_tab_options(client, block, true);
}

var wanted_mounts_initialized = false;
var wanted_mounts = [];

function want_mount(client, path, config) {
    wanted_mounts.push({ path: path, config: config });

    function parse_options(o) {
        return new Set(utils.decode_filename(o).split(","));
    }

    function superset(a, b) {
        for (const e of b)
            if (!a.has(e))
                return false;
        return true;
    }

    function config_matches(a, b) {
        console.log(utils.decode_filename(a.dir.v), utils.decode_filename(a.opts.v));
        const a_opts = parse_options(a.opts.v);
        const b_opts = parse_options(b.opts.v);
        return a.dir.v == b.dir.v && superset(a_opts, b_opts);
    }

    function try_wanted_mounts() {
        for (let i = 0; i < wanted_mounts.length; i++) {
            const m = wanted_mounts[i];
            const block = client.blocks[m.path];
            const block_fsys = client.blocks_fsys[m.path];
            if (block && block_fsys) {
                for (const c of block.Configuration) {
                    if (c[0] == "fstab") {
                        if (config_matches(c[1], m.config)) {
                            wanted_mounts.splice(i, 1);
                            block_fsys.Mount({}).catch(error => console.warn(error));
                        }
                        return;
                    }
                }
            }
        }
    }

    if (!wanted_mounts_initialized) {
        wanted_mounts_initialized = true;
        client.addEventListener("changed", try_wanted_mounts);
    }
}

export function format_dialog(client, path, start, size, enable_dos_extended) {
    var block = client.blocks[path];
    var block_ptable = client.blocks_ptable[path];

    var create_partition = (start !== undefined);

    var title;
    if (create_partition)
        title = cockpit.format(_("Create Partition on $0"), utils.block_name(block));
    else
        title = cockpit.format(_("Format $0"), utils.block_name(block));

    function is_filesystem(vals) {
        return vals.type != "empty" && vals.type != "dos-extended";
    }

    function is_encrypted(vals) {
        return vals.crypto.on;
    }

    function add_fsys(storaged_name, entry) {
        if (storaged_name === true ||
            (client.fsys_info[storaged_name] && client.fsys_info[storaged_name].can_format)) {
            filesystem_options.push(entry);
        }
    }

    var filesystem_options = [];
    add_fsys("xfs", { value: "xfs", title: "XFS - " + _("Recommended default") });
    add_fsys("ext4", { value: "ext4", title: "EXT4" });
    add_fsys("vfat", { value: "vfat", title: "VFAT" });
    add_fsys("ntfs", { value: "ntfs", title: "NTFS" });
    add_fsys(true, { value: "empty", title: _("No Filesystem") });
    if (create_partition && enable_dos_extended)
        add_fsys(true, { value: "dos-extended", title: _("Extended Partition") });

    var usage = utils.get_active_usage(client, create_partition ? null : path);

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in active use"), utils.block_name(block)),
            Body: BlockingMessage(usage)
        });
        return;
    }

    var crypto_options = initial_crypto_options(client, block);
    var mount_options = initial_mount_options(client, block);

    dialog_open({
        Title: title,
        Footer: TeardownMessage(usage),
        Fields: [].concat(
            [
                SizeSlider("size", _("Size"),
                           {
                               value: size,
                               max: size,
                               visible: function () {
                                   return create_partition;
                               }
                           }),
                SelectOne("erase", _("Erase"),
                          {
                              choices: [
                                  { value: "no", title: _("Don't overwrite existing data") },
                                  { value: "zero", title: _("Overwrite existing data with zeros") }
                              ]
                          }),
                SelectOne("type", _("Type"),
                          { choices: filesystem_options }),
                TextInput("name", _("Name"),
                          {
                              validate: (name, vals) => utils.validate_fsys_label(name, vals.type),
                              visible: is_filesystem
                          })
            ],
            mounting_dialog_fields(false, "", mount_options, () => false),
            [
                CheckBoxes("crypto", "",
                           {
                               fields: [
                                   { tag: "on", title: _("Encrypt data") }
                               ]
                           }),
                [
                    PassInput("passphrase", _("Passphrase"),
                              {
                                  validate: function (phrase) {
                                      if (phrase === "")
                                          return _("Passphrase cannot be empty");
                                  },
                                  visible: is_encrypted
                              }),
                    PassInput("passphrase2", _("Confirm"),
                              {
                                  validate: function (phrase2, vals) {
                                      if (phrase2 != vals.passphrase)
                                          return _("Passphrases do not match");
                                  },
                                  visible: is_encrypted
                              })
                ].concat(crypto_options_dialog_fields(crypto_options, is_encrypted, true))
            ]),
        _update: function (dlg, vals, trigger) {
            if (trigger == "crypto_options" && vals.crypto_options.auto == false)
                dlg.set_nested_values("mount_options", { auto: false });
            if (trigger == "crypto_options" && vals.crypto_options.ro == true)
                dlg.set_nested_values("mount_options", { ro: true });
            if (trigger == "mount_options" && vals.mount_options.auto == true)
                dlg.set_nested_values("crypto_options", { auto: true });
            if (trigger == "mount_options" && vals.mount_options.ro == false)
                dlg.set_nested_values("crypto_options", { ro: false });
        },
        Action: {
            Title: create_partition ? _("Create Partition") : _("Format"),
            Danger: (create_partition
                ? null : _("Formatting a storage device will erase all data on it.")),
            action: function (vals) {
                var options = {
                    'no-block': { t: 'b', v: true },
                    'dry-run-first': { t: 'b', v: true },
                    'tear-down': { t: 'b', v: true }
                };
                if (vals.erase != "no")
                    options.erase = { t: 's', v: vals.erase };
                if (vals.name)
                    options.label = { t: 's', v: vals.name };

                // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1516041
                if (client.vdo_overlay.find_by_block(block)) {
                    options['no-discard'] = { t: 'b', v: true };
                }

                var config_items = [];
                var mount_options = mounting_dialog_options(vals);
                var mount_config = null;
                if (vals.mount_point) {
                    mount_config = {
                        dir: { t: 'ay', v: utils.encode_filename(vals.mount_point) },
                        type: { t: 'ay', v: utils.encode_filename("auto") },
                        opts: { t: 'ay', v: utils.encode_filename(mount_options || "defaults") },
                        freq: { t: 'i', v: 0 },
                        passno: { t: 'i', v: 0 },
                        "track-parents": { t: 'b', v: true }
                    };
                    config_items.push(["fstab", mount_config]);
                }
                if (is_encrypted(vals)) {
                    options["encrypt.passphrase"] = { t: 's', v: vals.passphrase };

                    var item = {
                        options: { t: 'ay', v: utils.encode_filename(crypto_options_dialog_options(vals)) },
                        "track-parents": { t: 'b', v: true }
                    };
                    if (vals.crypto_options && vals.crypto_options.store_passphrase) {
                        item["passphrase-contents"] =
                                  { t: 'ay', v: utils.encode_filename(vals.passphrase) };
                    } else {
                        item["passphrase-contents"] =
                                  { t: 'ay', v: utils.encode_filename("") };
                    }
                    config_items.push(["crypttab", item]);
                }

                if (config_items.length > 0)
                    options["config-items"] = { t: 'a(sa{sv})', v: config_items };

                function format() {
                    if (create_partition) {
                        if (vals.type == "dos-extended")
                            return block_ptable.CreatePartition(start, vals.size, "0x05", "", { });
                        else if (vals.type == "empty")
                            return block_ptable.CreatePartition(start, vals.size, "", "", { });
                        else
                            return (block_ptable.CreatePartitionAndFormat(start, vals.size, "", "", { },
                                                                          vals.type, options)
                                    .then(path => {
                                        if (mount_config)
                                            want_mount(client, block.path, mount_config);
                                    }));
                    } else {
                        return block.Format(vals.type, options)
                                .then(() => {
                                    if (mount_config)
                                        want_mount(client, block.path, mount_config);
                                });
                    }
                }

                return utils.teardown_active_usage(client, usage).then(format);
            }
        }
    });
}
