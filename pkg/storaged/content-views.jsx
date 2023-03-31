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
import {
    dialog_open, TextInput, PassInput, SelectOne, SizeSlider, CheckBoxes,
    SelectSpaces, BlockingMessage, TeardownMessage, Message,
    init_active_usage_processes
} from "./dialog.jsx";
import * as utils from "./utils.js";

import React from "react";
import { Card, CardActions, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Text, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { DropdownSeparator } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";

import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import { StorageButton, StorageLink, StorageBarMenu, StorageMenuItem, StorageUsageBar } from "./storage-controls.jsx";
import * as PK from "packagekit.js";
import {
    format_dialog, parse_options, extract_option, unparse_options
} from "./format-dialog.jsx";
import { job_progress_wrapper } from "./jobs-panel.jsx";

import { FilesystemTab, is_mounted, mounting_dialog, get_fstab_config } from "./fsys-tab.jsx";
import { CryptoTab, edit_config } from "./crypto-tab.jsx";
import { get_existing_passphrase, unlock_with_type } from "./crypto-keyslots.jsx";
import { BlockVolTab, PoolVolTab, VDOPoolTab } from "./lvol-tabs.jsx";
import { PartitionTab } from "./part-tab.jsx";
import { SwapTab } from "./swap-tab.jsx";
import { UnrecognizedTab } from "./unrecognized-tab.jsx";
import { warnings_icon } from "./warnings.jsx";

const _ = cockpit.gettext;

const C_ = cockpit.gettext;

function next_default_logical_volume_name(client, vgroup, prefix) {
    function find_lvol(name) {
        const lvols = client.vgroups_lvols[vgroup.path];
        for (let i = 0; i < lvols.length; i++) {
            if (lvols[i].Name == name)
                return lvols[i];
        }
        return null;
    }

    let name;
    for (let i = 0; i < 1000; i++) {
        name = prefix + i.toFixed();
        if (!find_lvol(name))
            break;
    }

    return name;
}

export function set_crypto_options(block, readonly, auto, nofail, netdev) {
    return edit_config(block, (config, commit) => {
        const opts = config.options ? parse_options(utils.decode_filename(config.options.v)) : [];
        if (readonly !== null) {
            extract_option(opts, "readonly");
            if (readonly)
                opts.push("readonly");
        }
        if (auto !== null) {
            extract_option(opts, "noauto");
            if (!auto)
                opts.push("noauto");
        }
        if (nofail !== null) {
            extract_option(opts, "nofail");
            if (nofail)
                opts.push("nofail");
        }
        if (netdev !== null) {
            extract_option(opts, "_netdev");
            if (netdev)
                opts.push("_netdev");
        }
        config.options = { t: 'ay', v: utils.encode_filename(unparse_options(opts)) };
        return commit();
    });
}

export function set_crypto_auto_option(block, flag) {
    return set_crypto_options(block, null, flag, null, null);
}

function create_tabs(client, target, is_partition, is_extended) {
    function endsWith(str, suffix) {
        return str.indexOf(suffix, str.length - suffix.length) !== -1;
    }

    const block = endsWith(target.iface, ".Block") ? target : null;
    let is_crypto = (block && block.IdUsage == 'crypto');
    const content_block = is_crypto ? client.blocks_cleartext[block.path] : block;

    const block_fsys = content_block && client.blocks_fsys[content_block.path];
    const block_lvm2 = block && client.blocks_lvm2[block.path];
    const block_swap = content_block && client.blocks_swap[content_block.path];

    const block_stratis_blockdev = block && client.blocks_stratis_blockdev[block.path];
    const block_stratis_locked_pool = block && client.blocks_stratis_locked_pool[block.path];

    const lvol = (endsWith(target.iface, ".LogicalVolume")
        ? target
        : block_lvm2 && client.lvols[block_lvm2.LogicalVolume]);

    const is_filesystem = (content_block && content_block.IdUsage == 'filesystem');
    const is_stratis = ((content_block && content_block.IdUsage == "raid" && content_block.IdType == "stratis") ||
                        (block_stratis_blockdev && client.stratis_pools[block_stratis_blockdev.Pool]) ||
                        block_stratis_locked_pool);

    // Adjust for encryption leaking out of Stratis
    if (is_crypto && is_stratis)
        is_crypto = false;

    let warnings = client.path_warnings[target.path] || [];
    if (content_block)
        warnings = warnings.concat(client.path_warnings[content_block.path] || []);
    if (lvol)
        warnings = warnings.concat(client.path_warnings[lvol.path] || []);

    const tab_actions = [];
    const tab_menu_actions = [];
    const tab_menu_danger_actions = [];

    function add_action(title, func) {
        tab_actions.push(<StorageButton onlyWide key={title} onClick={func}>{title}</StorageButton>);
        tab_menu_actions.push({ title, func, only_narrow: true });
    }

    function add_danger_action(title, func) {
        tab_actions.push(<StorageButton onlyWide key={title} onClick={func}>{title}</StorageButton>);
        tab_menu_danger_actions.push({ title, func, only_narrow: true });
    }

    function add_menu_action(title, func) {
        tab_menu_actions.push({ title, func });
    }

    function add_menu_danger_action(title, func) {
        tab_menu_danger_actions.push({ title, func, danger: true });
    }

    const tabs = [];

    function add_tab(name, renderer, for_content, associated_warnings) {
        let tab_warnings = [];
        if (associated_warnings)
            tab_warnings = warnings.filter(w => associated_warnings.indexOf(w.warning) >= 0);
        if (tab_warnings.length > 0)
            name = <div className="content-nav-item-warning">{warnings_icon(tab_warnings)} {name}</div>;
        tabs.push(
            {
                name,
                renderer,
                data: {
                    client,
                    block: for_content ? content_block : block,
                    lvol,
                    warnings: tab_warnings,
                }
            });
    }

    function create_thin() {
        const vgroup = lvol && client.vgroups[lvol.VolumeGroup];
        if (!vgroup)
            return;

        dialog_open({
            Title: _("Create thin volume"),
            Fields: [
                TextInput("name", _("Name"),
                          {
                              value: next_default_logical_volume_name(client, vgroup, "lvol"),
                              validate: utils.validate_lvm2_name
                          }),
                SizeSlider("size", _("Size"),
                           {
                               value: lvol.Size,
                               max: lvol.Size * 3,
                               allow_infinite: true,
                               round: vgroup.ExtentSize
                           })
            ],
            Action: {
                Title: _("Create"),
                action: function (vals) {
                    return vgroup.CreateThinVolume(vals.name, vals.size, lvol.path, { });
                }
            }
        });
    }

    if (lvol) {
        if (lvol.Type == "pool") {
            add_tab(_("Pool"), PoolVolTab);
            add_action(_("Create thin volume"), create_thin);
        } else {
            add_tab(_("Volume"), BlockVolTab, false, ["unused-space", "partial-lvol"]);

            if (client.vdo_vols[lvol.path])
                add_tab(_("VDO pool"), VDOPoolTab);
        }
    }

    if (is_partition) {
        add_tab(_("Partition"), PartitionTab);
    }

    let is_unrecognized = false;

    if (is_filesystem) {
        add_tab(_("Filesystem"), FilesystemTab, true, ["mismounted-fsys"]);
    } else if (content_block && (content_block.IdUsage == "raid" ||
                                 client.legacy_vdo_overlay.find_by_backing_block(content_block))) {
        // no tab for these
    } else if (block_swap || (content_block && content_block.IdUsage == "other" && content_block.IdType == "swap")) {
        add_tab(_("Swap"), SwapTab, true);
    } else if (content_block) {
        is_unrecognized = true;
        add_tab(_("Unrecognized data"), UnrecognizedTab, true);
    }

    if (is_crypto) {
        const config = utils.array_find(client.blocks_crypto[block.path].ChildConfiguration, c => c[0] == "fstab");
        if (config && !content_block)
            add_tab(_("Filesystem"), FilesystemTab, false, ["mismounted-fsys"]);
        add_tab(_("Encryption"), CryptoTab);
    }

    function lock() {
        const crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        return crypto.Lock({}).then(() => set_crypto_auto_option(block, false));
    }

    function unlock() {
        const crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        return get_existing_passphrase(block, true).then(type => {
            return (unlock_with_type(client, block, null, type)
                    .then(() => set_crypto_auto_option(block, true))
                    .catch(() => unlock_with_passphrase()));
        });
    }

    function unlock_with_passphrase() {
        const crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        dialog_open({
            Title: _("Unlock"),
            Fields: [
                PassInput("passphrase", _("Passphrase"), {})
            ],
            Action: {
                Title: _("Unlock"),
                action: function (vals) {
                    return (crypto.Unlock(vals.passphrase, {})
                            .then(() => set_crypto_auto_option(block, true)));
                }
            }
        });
    }

    if (is_crypto) {
        if (client.blocks_cleartext[block.path]) {
            if (!block_fsys)
                add_menu_action(_("Lock"), lock);
        } else {
            const config = utils.array_find(client.blocks_crypto[block.path].ChildConfiguration,
                                            c => c[0] == "fstab");
            if (config && !content_block)
                add_action(_("Mount"), () => mounting_dialog(client, block, "mount"));
            else
                add_action(_("Unlock"), unlock);
        }
    }

    function activate() {
        return lvol.Activate({});
    }

    function deactivate() {
        return lvol.Deactivate({});
    }

    function create_snapshot() {
        dialog_open({
            Title: _("Create snapshot"),
            Fields: [
                TextInput("name", _("Name"),
                          { validate: utils.validate_lvm2_name }),
            ],
            Action: {
                Title: _("Create"),
                action: function (vals) {
                    return lvol.CreateSnapshot(vals.name, vals.size || 0, { });
                }
            }
        });
    }

    function repair() {
        const vgroup = lvol && client.vgroups[lvol.VolumeGroup];
        if (!vgroup)
            return;

        const summary = client.lvols_stripe_summary[lvol.path];
        const missing = summary.reduce((sum, sub) => sum + (sub["/"] ?? 0), 0);

        function usable(pvol) {
            // must have some free space and not already used for a
            // subvolume other than those that need to be repaired.
            return pvol.FreeSize > 0 && !summary.some(sub => !sub["/"] && sub[pvol.path]);
        }

        const pvs_as_spaces = client.vgroups_pvols[vgroup.path].filter(usable).map(pvol => {
            const block = client.blocks[pvol.path];
            return { type: 'block', block, size: pvol.FreeSize, desc: "", pvol };
        });

        const available = pvs_as_spaces.reduce((sum, spc) => sum + spc.size, 0);

        if (available < missing) {
            dialog_open({
                Title: cockpit.format(_("Unable to repair logical volume $0"), lvol.Name),
                Body: <p>{cockpit.format(_("There is not enough space available that could be used for a repair. At least $0 are needed on physical volumes that are not already used for this logical volume."),
                                         utils.fmt_size(missing))}</p>
            });
            return;
        }

        function enough_space(pvs) {
            const selected = pvs.reduce((sum, pv) => sum + pv.size, 0);
            if (selected < missing)
                return cockpit.format(_("An additonal $0 must be selected"), utils.fmt_size(missing - selected));
        }

        dialog_open({
            Title: cockpit.format(_("Repair logical volume $0"), lvol.Name),
            Body: <div><p>{cockpit.format(_("Select the physical volumes that should be used to repair the logical volume. At leat $0 are needed."),
                                     utils.fmt_size(missing))}</p><br/></div>,
            Fields: [
                SelectSpaces("pvs", _("Physical Volumes"),
                             {
                                 spaces: pvs_as_spaces,
                                 validate: enough_space
                             }),
            ],
            Action: {
                Title: _("Repair"),
                action: function (vals) {
                    return lvol.Repair(vals.pvs.map(spc => spc.block.path), { });
                }
            }
        });
    }

    if (lvol) {
        if (lvol.Type != "pool") {
            if (lvol.Active) {
                add_menu_action(_("Deactivate"), deactivate);
            } else {
                add_action(_("Activate"), activate);
            }
        }
        if (client.lvols[lvol.ThinPool]) {
            add_menu_action(_("Create snapshot"), create_snapshot);
        }
        const status_code = client.lvols_status[lvol.path];
        if (status_code == "degraded" || status_code == "degraded-maybe-partial")
            add_menu_action(_("Repair"), repair);
    }

    function swap_start() {
        return block_swap.Start({});
    }

    function swap_stop() {
        return block_swap.Stop({});
    }

    if (block_swap) {
        if (block_swap.Active)
            add_menu_action(_("Stop"), swap_stop);
        else
            add_menu_action(_("Start"), swap_start);
    }

    function delete_() {
        let block_part;

        /* This is called only for logical volumes and partitions
         */

        if (block)
            block_part = client.blocks_part[block.path];

        let name, danger;

        if (lvol) {
            name = utils.lvol_name(lvol);
            danger = _("Deleting a logical volume will delete all data in it.");
        } else if (block_part) {
            name = utils.block_name(block);
            danger = _("Deleting a partition will delete all data in it.");
        }

        if (name) {
            const usage = utils.get_active_usage(client, target.path, _("delete"));

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in use"), name),
                    Body: BlockingMessage(usage)
                });
                return;
            }

            dialog_open({
                Title: cockpit.format(_("Permanently delete $0?"), name),
                Teardown: TeardownMessage(usage),
                Action: {
                    Danger: danger,
                    Title: _("Delete"),
                    action: function () {
                        return utils.teardown_active_usage(client, usage)
                                .then(function () {
                                    if (lvol)
                                        return lvol.Delete({ 'tear-down': { t: 'b', v: true } });
                                    else if (block_part)
                                        return block_part.Delete({ 'tear-down': { t: 'b', v: true } });
                                })
                                .then(utils.reload_systemd);
                    }
                },
                Inits: [
                    init_active_usage_processes(client, usage)
                ]
            });
        }
    }

    if (block && !is_extended) {
        if (is_unrecognized)
            add_danger_action(_("Format"), () => format_dialog(client, block.path));
        else
            add_menu_danger_action(_("Format"), () => format_dialog(client, block.path));
    }

    if (is_partition || lvol) {
        add_menu_danger_action(_("Delete"), delete_);
    }

    if (block_fsys) {
        if (is_mounted(client, content_block))
            add_menu_action(_("Unmount"), () => mounting_dialog(client, content_block, "unmount"));
        else
            add_action(_("Mount"), () => mounting_dialog(client, content_block, "mount"));
    }

    return {
        renderers: tabs,
        actions: tab_actions,
        menu_actions: tab_menu_actions,
        menu_danger_actions: tab_menu_danger_actions,
        warnings
    };
}

function block_description(client, block) {
    let type, used_for, link, size, critical_size;
    const block_stratis_blockdev = client.blocks_stratis_blockdev[block.path];
    const block_stratis_locked_pool = client.blocks_stratis_locked_pool[block.path];
    const vdo = client.legacy_vdo_overlay.find_by_backing_block(block);
    const cleartext = client.blocks_cleartext[block.path];
    if (cleartext)
        block = cleartext;

    const block_pvol = client.blocks_pvol[block.path];
    let omit_encrypted_label = false;

    size = block.Size;

    if (block.IdUsage == "crypto" && !cleartext) {
        const [config, mount_point] = get_fstab_config(block, true);
        if (config) {
            type = C_("storage-id-desc", "Filesystem (encrypted)");
            used_for = mount_point;
        } else if (block_stratis_locked_pool) {
            type = _("Stratis member");
            used_for = block_stratis_locked_pool;
            link = ["pool", used_for];
            omit_encrypted_label = true;
        } else
            type = C_("storage-id-desc", "Locked encrypted data");
    } else if (block.IdUsage == "filesystem") {
        const [, mount_point] = get_fstab_config(block, true);
        type = cockpit.format(C_("storage-id-desc", "$0 filesystem"), block.IdType);
        if (client.fsys_sizes.data[mount_point])
            size = client.fsys_sizes.data[mount_point];
        used_for = mount_point;
    } else if (block.IdUsage == "raid") {
        if (block_pvol && client.vgroups[block_pvol.VolumeGroup]) {
            const vgroup = client.vgroups[block_pvol.VolumeGroup];
            type = _("LVM2 member");
            used_for = vgroup.Name;
            link = ["vg", used_for];
            size = [block_pvol.Size - block_pvol.FreeSize, block_pvol.Size];
            critical_size = 1;
        } else if (client.mdraids[block.MDRaidMember]) {
            const mdraid = client.mdraids[block.MDRaidMember];
            type = _("RAID member");
            used_for = utils.mdraid_name(mdraid);
            link = ["mdraid", mdraid.UUID];
        } else if (block_stratis_blockdev && client.stratis_pools[block_stratis_blockdev.Pool]) {
            const pool = client.stratis_pools[block_stratis_blockdev.Pool];
            type = _("Stratis member");
            used_for = pool.Name;
            link = ["pool", pool.Uuid];
            omit_encrypted_label = true;
        } else if (block.IdType == "LVM2_member") {
            type = _("LVM2 member");
        } else if (block.IdType == "stratis") {
            type = _("Stratis member");
            omit_encrypted_label = true;
        } else {
            type = _("RAID member");
        }
    } else if (block.IdUsage == "other") {
        if (block.IdType == "swap") {
            type = C_("storage-id-desc", "Swap space");
        } else {
            type = C_("storage-id-desc", "Other data");
        }
    } else if (vdo) {
        type = C_("storage-id-desc", "VDO backing");
        used_for = vdo.name;
        link = ["vdo", vdo.name];
    } else if (client.blocks_swap[block.path]) {
        type = C_("storage-id-desc", "Swap space");
    } else {
        type = C_("storage-id-desc", "Unrecognized data");
    }

    if (cleartext && !omit_encrypted_label)
        type = cockpit.format(_("$0 (encrypted)"), type);

    return {
        type,
        used_for,
        link,
        size,
        critical_size
    };
}

function append_row(client, rows, level, key, name, desc, tabs, job_object) {
    function menuitem(action) {
        if (action.title)
            return <StorageMenuItem onlyNarrow={action.only_narrow} key={action.title} onClick={action.func} danger={action.danger}>{action.title}</StorageMenuItem>;
        else
            return <DropdownSeparator className={action.only_narrow ? "show-only-when-narrow" : null} key="sep" />;
    }

    let menu = null;
    const menu_actions = tabs.menu_actions || [];
    const menu_danger_actions = tabs.menu_danger_actions || [];
    const menu_actions_wide_count = menu_actions.filter(a => !a.only_narrow).length;
    const menu_danger_actions_wide_count = menu_danger_actions.filter(a => !a.only_narrow).length;

    const menu_sep = [];
    if (menu_actions.length > 0 && menu_danger_actions.length > 0)
        menu_sep.push({
            title: null,
            only_narrow: !(menu_actions_wide_count > 0 && menu_danger_actions_wide_count > 0)
        });

    if (menu_actions.length + menu_danger_actions.length > 0)
        menu = <StorageBarMenu id={"menu-" + name}
                               onlyNarrow={!(menu_actions_wide_count + menu_danger_actions_wide_count > 0)}
                               menuItems={menu_actions.concat(menu_sep).concat(menu_danger_actions)
                                       .map(menuitem)}
                               isKebab />;

    let info = null;
    if (job_object && client.path_jobs[job_object])
        info = <Spinner isSVG size="md" />;
    if (tabs.warnings.length > 0)
        info = <>{info}{warnings_icon(tabs.warnings)}</>;
    if (info)
        info = <>{"\n"}{info}</>;

    const cols = [
        {
            title: (
                <span key={name}>
                    {name}
                    {info}
                </span>)
        },
        { title: desc.type },
        { title: desc.link ? <StorageLink onClick={() => cockpit.location.go(desc.link)}>{desc.used_for}</StorageLink> : desc.used_for },
        {
            title: desc.size.length
                ? <StorageUsageBar stats={desc.size} critical={desc.critical_size || 0.95} block={name} />
                : utils.fmt_size(desc.size),
            props: { className: "ct-text-align-right" }
        },
        { title: <>{tabs.actions}{menu}</>, props: { className: "pf-c-table__action content-action" } },
    ];

    rows.push({
        props: { key, className: "content-level-" + level },
        columns: cols,
        expandedContent: tabs.renderers.length > 0 ? <ListingPanel tabRenderers={tabs.renderers} /> : null
    });
}

function append_non_partitioned_block(client, rows, level, block, is_partition) {
    const tabs = create_tabs(client, block, is_partition);
    const desc = block_description(client, block);

    append_row(client, rows, level, block.path, utils.block_name(block), desc, tabs, block.path);
}

function append_partitions(client, rows, level, block) {
    const block_ptable = client.blocks_ptable[block.path];
    const device_level = level;

    const is_dos_partitioned = (block_ptable.Type == 'dos');

    function append_free_space(level, start, size) {
        function create_partition() {
            format_dialog(client, block.path, start, size, is_dos_partitioned && level <= device_level);
        }

        const btn = (
            <StorageButton onlyWide onClick={create_partition}>
                {_("Create partition")}
            </StorageButton>
        );

        const item = (
            <StorageMenuItem key="create"
                             onlyNarrow
                             onClick={create_partition}>
                {_("Create partition")}
            </StorageMenuItem>);

        const menu = <StorageBarMenu onlyNarrow menuItems={[item]} isKebab />;

        const cols = [
            _("Free space"),
            { },
            { },
            { title: utils.fmt_size(size), props: { className: "ct-text-align-right" } },
            { title: <>{btn}{menu}</>, props: { className: "pf-c-table__action content-action" } },
        ];

        rows.push({
            columns: cols,
            props: { key: "free-space-" + rows.length.toString(), className: "content-level-" + level }
        });
    }

    function append_extended_partition(level, partition) {
        const desc = {
            size: partition.size,
            type: _("Extended partition")
        };
        const tabs = create_tabs(client, partition.block, true, true);
        append_row(client, rows, level, partition.block.path, utils.block_name(partition.block), desc, tabs, partition.block.path);
        process_partitions(level + 1, partition.partitions);
    }

    function process_partitions(level, partitions) {
        let i, p;
        for (i = 0; i < partitions.length; i++) {
            p = partitions[i];
            if (p.type == 'free')
                append_free_space(level, p.start, p.size);
            else if (p.type == 'container')
                append_extended_partition(level, p);
            else
                append_non_partitioned_block(client, rows, level, p.block, true);
        }
    }

    process_partitions(level, utils.get_partitions(client, block));
}

function append_device(client, rows, level, block) {
    if (client.blocks_ptable[block.path])
        append_partitions(client, rows, level, block);
    else
        append_non_partitioned_block(client, rows, level, block, null);
}

// TODO: this should be refactored to React component
// The render method should collect _just_ data via more-or-less recent append_device() flow and
// then return proper React component hierarchy based on this collected data.
// Benefit: much easier debugging, better manipulation with "key" props and relying on well-tested React's functionality
function block_rows(client, block) {
    const rows = [];
    append_device(client, rows, 0, block);
    return rows;
}

const BlockContent = ({ client, block, allow_partitions }) => {
    if (!block)
        return null;

    if (block.Size === 0)
        return null;

    function format_disk() {
        const usage = utils.get_active_usage(client, block.path, _("initialize"), _("delete"));

        if (usage.Blocking) {
            dialog_open({
                Title: cockpit.format(_("$0 is in use"), utils.block_name(block)),
                Body: BlockingMessage(usage),
            });
            return;
        }

        dialog_open({
            Title: cockpit.format(_("Initialize disk $0"), utils.block_name(block)),
            Teardown: TeardownMessage(usage),
            Fields: [
                SelectOne("type", _("Partitioning"),
                          {
                              value: "gpt",
                              choices: [
                                  { value: "dos", title: _("Compatible with all systems and devices (MBR)") },
                                  {
                                      value: "gpt",
                                      title: _("Compatible with modern system and hard disks > 2TB (GPT)")
                                  },
                                  { value: "empty", title: _("No partitioning") }
                              ]
                          }),
                CheckBoxes("erase", _("Overwrite"),
                           {
                               fields: [
                                   { tag: "on", title: _("Overwrite existing data with zeros (slower)") }
                               ],
                           }),
            ],
            Action: {
                Title: _("Initialize"),
                Danger: _("Initializing erases all data on a disk."),
                wrapper: job_progress_wrapper(client, block.path),
                action: function (vals) {
                    const options = {
                        'tear-down': { t: 'b', v: true }
                    };
                    if (vals.erase.on)
                        options.erase = { t: 's', v: "zero" };
                    return utils.teardown_active_usage(client, usage)
                            .then(function () {
                                return block.Format(vals.type, options);
                            })
                            .then(utils.reload_systemd);
                }
            },
            Inits: [
                init_active_usage_processes(client, usage)
            ]
        });
    }

    let format_disk_btn = null;
    if (allow_partitions)
        format_disk_btn = (
            <StorageButton onClick={format_disk} excuse={block.ReadOnly ? _("Device is read-only") : null}>
                {_("Create partition table")}
            </StorageButton>
        );

    let title;
    if (client.blocks_ptable[block.path])
        title = _("Partitions");
    else
        title = _("Content");

    return (
        <Card>
            <CardHeader>
                <CardTitle><Text component={TextVariants.h2}>{title}</Text></CardTitle>
                <CardActions>{format_disk_btn}</CardActions>
            </CardHeader>
            <CardBody className="contains-list">
                <ListingTable rows={ block_rows(client, block) }
                              aria-label={_("Content")}
                              columns={[_("Name"), _("Type"), _("Used for"), _("Size")]}
                              showHeader={false} />
            </CardBody>
        </Card>
    );
};

export const Block = ({ client, block, allow_partitions }) => {
    return (
        <BlockContent client={client}
                      block={block}
                      allow_partitions={allow_partitions !== false} />
    );
};

function append_logical_volume_block(client, rows, level, block, lvol) {
    const desc = client.blocks_ptable[block.path]
        ? {
            size: block.Size,
            type: _("Partitioned block device"),
            used_for: utils.block_name(block),
            link: [utils.block_name(block).replace(/^\/dev\//, "")]
        }
        : block_description(client, block);
    const tabs = create_tabs(client, block, false);
    append_row(client, rows, level, block.path, lvol.Name, desc, tabs, block.path);
}

function append_logical_volume(client, rows, level, lvol) {
    let tabs, desc, block;

    if (lvol.Type == "pool") {
        desc = {
            size: lvol.Size,
            type: _("Pool for thin volumes")
        };
        tabs = create_tabs(client, lvol, false);
        append_row(client, rows, level, lvol.Name, lvol.Name, desc, tabs, false);
        client.lvols_pool_members[lvol.path].forEach(function (member_lvol) {
            append_logical_volume(client, rows, level + 1, member_lvol);
        });
    } else {
        block = client.lvols_block[lvol.path];
        if (block)
            append_logical_volume_block(client, rows, level, block, lvol);
        else {
            // If we can't find the block for a active
            // volume, Storaged or something below is
            // probably misbehaving, and we show it as
            // "unsupported".

            desc = {
                size: lvol.Size,
                type: lvol.Active ? _("Unsupported volume") : _("Inactive volume")
            };
            tabs = create_tabs(client, lvol, false);
            append_row(client, rows, level, lvol.Name, lvol.Name, desc, tabs, false);
        }
    }
}

function vgroup_rows(client, vgroup) {
    const rows = [];

    const isVDOPool = lvol => Object.keys(client.vdo_vols).some(v => client.vdo_vols[v].VDOPool == lvol.path);

    (client.vgroups_lvols[vgroup.path] || []).forEach(lvol => {
        // Don't display VDO pool volumes as separate entities; they are an internal implementation detail and have no actions
        if (lvol.ThinPool == "/" && lvol.Origin == "/" && !isVDOPool(lvol))
            append_logical_volume(client, rows, 0, lvol);
    });
    return rows;
}

function install_package(name, progress) {
    return PK.check_missing_packages([name], p => progress(_("Checking installed software"), p.cancel))
            .then(data => {
                if (data.unavailable_names.length > 0)
                    return Promise.reject(new Error(
                        cockpit.format(_("$0 is not available from any repository."), data.unavailable_names[0])));
                // let's be cautious here, we really don't expect removals
                if (data.remove_names.length > 0)
                    return Promise.reject(new Error(
                        cockpit.format(_("Installing $0 would remove $1."), name, data.remove_names[0])));

                return PK.install_missing_packages(data, p => progress(_("Installing packages"), p.cancel));
            });
}

export class VGroup extends React.Component {
    constructor () {
        super();
        this.on_fsys_samples = () => { this.setState({}) };
    }

    componentDidMount() {
        this.props.client.fsys_sizes.addEventListener("changed", this.on_fsys_samples);
    }

    componentWillUnmount() {
        this.props.client.fsys_sizes.removeEventListener("changed", this.on_fsys_samples);
    }

    render() {
        const self = this;
        const vgroup = this.props.vgroup;
        const client = self.props.client;

        function create_logical_volume() {
            if (vgroup.FreeSize == 0)
                return;

            const can_do_layouts = !!vgroup.CreatePlainVolumeWithLayout;

            const purposes = [
                {
                    value: "block",
                    title: _("Block device for filesystems"),
                },
                { value: "pool", title: _("Pool for thinly provisioned volumes") }
                /* Not implemented
                                                 { value: "cache", Title: _("Cache") }
                                                 */
            ];

            const layouts = [
                {
                    value: "linear",
                    title: _("Linear"),
                },
                {
                    value: "linear_with_pvs",
                    title: _("Linear on selected physical volumes"),
                },
                {
                    value: "raid0",
                    title: _("Striped (RAID 0)"),
                },
                {
                    value: "raid1",
                    title: _("Mirrored (RAID 1)"),
                },
                {
                    value: "raid10",
                    title: _("Striped and mirrored (RAID 10)"),
                },
                {
                    value: "raid5",
                    title: _("Distributed parity (RAID 5)"),
                },
                {
                    value: "raid6",
                    title: _("Double distributed parity (RAID 6)"),
                }
            ];

            const vdo_package = client.get_config("vdo_package", null);
            const need_vdo_install = vdo_package && !(client.features.lvm_create_vdo || client.features.legacy_vdo);

            if (client.features.lvm_create_vdo || client.features.legacy_vdo || vdo_package)
                purposes.push({ value: "vdo", title: _("VDO filesystem volume (compression/deduplication)") });

            const pvs_as_spaces = client.vgroups_pvols[vgroup.path].filter(pvol => pvol.FreeSize > 0).map(pvol => {
                const block = client.blocks[pvol.path];
                return { type: 'block', block, size: pvol.FreeSize, desc: "", pvol };
            });

            function validate_pvs(val, vals) {
                const { layout, pvs } = vals;

                if (layout == "raid0") {
                    if (pvs.length < 2)
                        return _("At least two physical volumes must be selected.");
                } else if (layout == "raid1") {
                    if (pvs.length < 2)
                        return _("Exactly two physical volumes must be selected.");
                } else if (layout == "raid10") {
                    if (pvs.length < 4)
                        return _("At least four physical volumes must be selected.");
                    if (pvs.length % 2 != 0)
                        return _("An even number of physical volumes must be selected.");
                } else if (layout == "raid4" || layout == "raid5") {
                    if (pvs.length < 3)
                        return _("At least three physical volumes must be selected.");
                } else if (layout == "raid6") {
                    if (pvs.length < 5)
                        return _("At least five physical volumes must be selected.");
                } else {
                    if (pvs.length < 1)
                        return _("At least one physical volume must be selected.");
                }
            }

            /* For layouts with redundancy, CreatePlainVolumeWithLayout will
             * create as many subvolumes as there are selected PVs.  This has
             * the nice effect of making the calculation of the maximum size of
             * such a volume trivial.
             */

            function max_size(vals) {
                const layout = vals.layout;
                const pvs = vals.pvs.map(s => s.pvol);
                const n_pvs = pvs.length;
                const sum = pvs.reduce((sum, pv) => sum + pv.FreeSize, 0);
                const min = Math.min.apply(null, pvs.map(pv => pv.FreeSize));

                function metasize(datasize) {
                    const default_regionsize = 2 * 1024 * 1024;
                    const regions = Math.ceil(datasize / default_regionsize);
                    const bytes = 2 * 4096 + Math.ceil(regions / 8);
                    return vgroup.ExtentSize * Math.ceil(bytes / vgroup.ExtentSize);
                }

                if (layout == "linear") {
                    return vgroup.FreeSize;
                } else if (layout == "linear_with_pvs") {
                    return sum;
                } else if (layout == "raid0" && n_pvs >= 2) {
                    return n_pvs * min;
                } else if (layout == "raid1" && n_pvs >= 2) {
                    return min - metasize(min);
                } else if (layout == "raid10" && n_pvs >= 4) {
                    return (n_pvs / 2) * (min - metasize(min));
                } else if ((layout == "raid4" || layout == "raid5") && n_pvs >= 3) {
                    return (n_pvs - 1) * (min - metasize(min));
                } else if (layout == "raid6" && n_pvs >= 5) {
                    return (n_pvs - 2) * (min - metasize(min));
                } else
                    return 0;
            }

            const layout_descriptions = {
                linear_with_pvs: _("Data will be stored on the selected physical volumes without any additional redundancy or performance improvements."),
                raid0: _("Data will be stored on the selected physical volumes in an alternating fashion to improve performance. At least two volumes need to be selected."),
                raid1: _("Data will be stored as two or more copies on the selected physical volumes, to improve reliability. At least two volumes need to be selected."),
                raid10: _("Data will be stored as two copies and also in an alternating fashion on the selected physical volumes, to improve both reliability and performance. At least four volumes need to be selected."),
                raid4: _("Data will be stored on the selected physical volumes so that one of them can be lost without affecting the data. At least three volumes need to be selected."),
                raid5: _("Data will be stored on the selected physical volumes so that one of them can be lost without affecting the data. Data is also stored in an alternating fashion to improve performance. At least three volumes need to be selected."),
                raid6: _("Data will be stored on the selected physical volumes so that up to two of them can be lost at the same time without affecting the data. Data is also stored in an alternating fashion to improve performance. At least five volumes need to be selected."),
            };

            dialog_open({
                Title: _("Create logical volume"),
                Fields: [
                    TextInput("name", _("Name"),
                              {
                                  value: next_default_logical_volume_name(client, vgroup, "lvol"),
                                  validate: utils.validate_lvm2_name
                              }),
                    SelectOne("purpose", _("Purpose"),
                              {
                                  value: "block",
                                  choices: purposes
                              }),
                    Message(cockpit.format(_("The $0 package will be installed to create VDO devices."), vdo_package),
                            {
                                visible: vals => vals.purpose === 'vdo' && need_vdo_install,
                            }),

                    SelectOne("layout", _("Layout"),
                              {
                                  value: "linear",
                                  choices: layouts,
                                  visible: vals => can_do_layouts && vals.purpose === 'block',
                                  explanation: layout_descriptions.linear
                              }),
                    SelectSpaces("pvs", _("Physical Volumes"),
                                 {
                                     spaces: pvs_as_spaces,
                                     visible: vals => can_do_layouts && vals.layout != "linear" && vals.purpose === 'block',
                                     validate: validate_pvs
                                 }),
                    SizeSlider("size", _("Size"),
                               {
                                   visible: vals => vals.purpose !== 'vdo',
                                   max: vgroup.FreeSize,
                                   round: vgroup.ExtentSize
                               }),
                    /* VDO parameters */
                    SizeSlider("vdo_psize", _("Size"),
                               {
                                   visible: vals => vals.purpose === 'vdo',
                                   min: 5 * 1024 * 1024 * 1024,
                                   max: vgroup.FreeSize,
                                   round: vgroup.ExtentSize
                               }),
                    SizeSlider("vdo_lsize", _("Logical size"),
                               {
                                   visible: vals => vals.purpose === 'vdo',
                                   value: vgroup.FreeSize,
                                   // visually point out that this can be over-provisioned
                                   max: vgroup.FreeSize * 3,
                                   allow_infinite: true,
                                   round: vgroup.ExtentSize
                               }),

                    CheckBoxes("vdo_options", _("Options"),
                               {
                                   visible: vals => vals.purpose === 'vdo',
                                   fields: [
                                       {
                                           tag: "compression",
                                           title: _("Compression"),
                                           tooltip: _("Save space by compressing individual blocks with LZ4")
                                       },
                                       {
                                           tag: "deduplication",
                                           title: _("Deduplication"),
                                           tooltip: _("Save space by storing identical data blocks just once")
                                       },
                                   ],
                                   value: {
                                       compression: true,
                                       deduplication: true,
                                   }
                               }),
                ],
                update: (dlg, vals, trigger) => {
                    if (vals.purpose == 'block' && (trigger == "layout" || trigger == "pvs" || trigger == "purpose")) {
                        const max = max_size(vals);
                        const old_max = dlg.get_options("size").max;
                        if (vals.size > max || vals.size == old_max)
                            dlg.set_values({ size: max });
                        dlg.set_options("size", { max });
                        dlg.set_options("layout", { explanation: layout_descriptions[vals.layout] });
                    } else if (trigger == "purpose") {
                        dlg.set_options("size", { max: vgroup.FreeSize });
                    }
                },
                Action: {
                    Title: _("Create"),
                    action: (vals, progress) => {
                        if (vals.purpose == "block") {
                            if (!can_do_layouts || vals.layout == "linear")
                                return vgroup.CreatePlainVolume(vals.name, vals.size, { });
                            else {
                                let layout = vals.layout;
                                if (layout == "linear_with_pvs")
                                    layout = "linear";
                                return vgroup.CreatePlainVolumeWithLayout(vals.name, vals.size, layout,
                                                                          vals.pvs.map(spc => spc.block.path),
                                                                          { });
                            }
                        } else if (vals.purpose == "pool")
                            return vgroup.CreateThinPoolVolume(vals.name, vals.size, { });
                        else if (vals.purpose == "vdo") {
                            return (need_vdo_install ? install_package(vdo_package, progress) : Promise.resolve())
                                    .then(() => {
                                        progress(_("Creating VDO device")); // not cancellable any more
                                        return vgroup.CreateVDOVolume(
                                            // HACK: emulate lvcreate's automatic pool name creation until
                                            // https://github.com/storaged-project/udisks/issues/939
                                            vals.name, next_default_logical_volume_name(client, vgroup, "vpool"),
                                            vals.vdo_psize, vals.vdo_lsize,
                                            0, // default index memory
                                            vals.vdo_options.compression, vals.vdo_options.deduplication,
                                            "auto", { });
                                    });
                        }
                    }
                }
            });
        }

        let excuse = null;
        if (vgroup.MissingPhysicalVolumes && vgroup.MissingPhysicalVolumes.length > 0)
            excuse = _("New logical volumes can not be created while a volume group is missing physical volumes.");
        else if (vgroup.FreeSize == 0)
            excuse = _("No free space");

        const new_volume_link = (
            <StorageButton onClick={create_logical_volume}
                           excuse={excuse}>
                {_("Create new logical volume")}
            </StorageButton>
        );

        return (
            <Card>
                <CardHeader>
                    <CardTitle><Text component={TextVariants.h2}>{_("Logical volumes")}</Text></CardTitle>
                    <CardActions>{new_volume_link}</CardActions>
                </CardHeader>
                <CardBody className="contains-list">
                    <ListingTable emptyCaption={_("No logical volumes")}
                                  aria-label={_("Logical volumes")}
                                  columns={[_("Name"), _("Type"), _("Used for"), _("Size")]}
                                  showHeader={false}
                                  rows={vgroup_rows(client, vgroup)} />
                </CardBody>
            </Card>
        );
    }
}
