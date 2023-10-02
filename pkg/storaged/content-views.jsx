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
import { set_crypto_auto_option } from "./utils.js";

import React from "react";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import {
    DropdownSeparator
} from '@patternfly/react-core/dist/esm/deprecated/components/Dropdown/index.js';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";

import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import { StorageButton, StorageBarMenu, StorageMenuItem, StorageUsageBar } from "./storage-controls.jsx";
import * as PK from "packagekit.js";
import { format_dialog } from "./format-dialog.jsx";
import { job_progress_wrapper } from "./jobs-panel.jsx";

import { FilesystemTab, is_mounted, mounting_dialog, get_fstab_config } from "./fsys-tab.jsx";
import { CryptoTab } from "./crypto-tab.jsx";
import { get_existing_passphrase, unlock_with_type } from "./crypto-keyslots.jsx";
import { BlockVolTab, PoolVolTab, VDOPoolTab } from "./lvol-tabs.jsx";
import { PVolTab, MDRaidMemberTab, VDOBackingTab, StratisBlockdevTab } from "./pvol-tabs.jsx";
import { PartitionTab } from "./part-tab.jsx";
import { SwapTab } from "./swap-tab.jsx";
import { UnrecognizedTab } from "./unrecognized-tab.jsx";
import { warnings_icon } from "./warnings.jsx";
import { vgroup_rename, vgroup_delete } from "./vgroup-details.jsx";

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

export function pvs_to_spaces(client, pvs) {
    return pvs.map(pvol => {
        const block = client.blocks[pvol.path];
        const parts = utils.get_block_link_parts(client, pvol.path);
        const text = cockpit.format(parts.format, parts.link);
        return { type: 'block', block, size: pvol.FreeSize, desc: text, pvol };
    });
}

export function create_tabs(client, target, options) {
    function endsWith(str, suffix) {
        return str.indexOf(suffix, str.length - suffix.length) !== -1;
    }

    const block = endsWith(target.iface, ".Block") ? target : null;
    let is_crypto = (block && block.IdUsage == 'crypto');
    const content_block = is_crypto ? client.blocks_cleartext[block.path] : block;

    const block_fsys = content_block && client.blocks_fsys[content_block.path];
    const block_lvm2 = block && client.blocks_lvm2[block.path];
    const block_pvol = content_block && client.blocks_pvol[content_block.path];
    const block_swap = content_block && client.blocks_swap[content_block.path];

    const block_stratis_blockdev = block && client.blocks_stratis_blockdev[block.path];
    const block_stratis_stopped_pool = block && client.blocks_stratis_stopped_pool[block.path];

    const lvol = (endsWith(target.iface, ".LogicalVolume")
        ? target
        : block_lvm2 && client.lvols[block_lvm2.LogicalVolume]);

    const is_filesystem = (content_block && content_block.IdUsage == 'filesystem');
    const is_stratis = ((content_block && content_block.IdUsage == "raid" && content_block.IdType == "stratis") ||
                        (block_stratis_blockdev && client.stratis_pools[block_stratis_blockdev.Pool]) ||
                        block_stratis_stopped_pool);

    const target_name = lvol ? utils.lvol_name(lvol) : block ? utils.block_name(block) : null;

    // Adjust for encryption leaking out of Stratis
    if (is_crypto && is_stratis)
        is_crypto = false;

    let warnings = client.path_warnings[target.path] || [];
    if (content_block)
        warnings = warnings.concat(client.path_warnings[content_block.path] || []);
    if (lvol)
        warnings = warnings.concat(client.path_warnings[lvol.path] || []);

    const tab_actions = [];
    const tab_hints = [];
    const tab_menu_actions = [];
    const tab_menu_danger_actions = [];

    function add_action(title, func, unified_hint) {
        if (options.unified) {
            tab_menu_actions.push({ title, func });
            if (unified_hint)
                tab_hints.push(unified_hint);
        } else {
            if (tab_actions.length == 0) {
                tab_actions.push(<StorageButton onlyWide key={title} onClick={func}>{title}</StorageButton>);
                tab_menu_actions.push({ title, func, only_narrow: true });
            } else {
                add_menu_action(title, func);
            }
        }
    }

    function add_danger_action(title, func) {
        if (options.unified) {
            tab_menu_danger_actions.push({ title, func });
        } else {
            if (tab_actions.length == 0) {
                tab_actions.push(<StorageButton onlyWide key={title} onClick={func}>{title}</StorageButton>);
                tab_menu_danger_actions.push({ title, func, only_narrow: true });
            } else {
                add_menu_danger_action(title, func);
            }
        }
    }

    function add_menu_action(title, func) {
        tab_menu_actions.push({ title, func });
    }

    function add_menu_danger_action(title, func) {
        tab_menu_danger_actions.push({ title, func, danger: true });
    }

    const tabs = [];

    function add_tab(name, renderer, for_content, associated_warnings) {
        // No tabs on the unified overview
        // XXX - what about warnings?
        if (options.unified)
            return;

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
                    options
                }
            });
    }

    function create_thin() {
        const vgroup = lvol && client.vgroups[lvol.VolumeGroup];
        if (!vgroup)
            return;

        dialog_open({
            Title: cockpit.format(_("Create thin volume in $0/$1"), vgroup.Name, lvol.Name),
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
            add_tab(_("Logical volume"), BlockVolTab, false, ["unused-space", "partial-lvol"]);

            if (client.vdo_vols[lvol.path])
                add_tab(_("VDO pool"), VDOPoolTab);
        }
    }

    if (block && client.blocks_part[block.path]) {
        add_tab(_("Partition"), PartitionTab, false, ["unused-space"]);
    }

    let is_unrecognized = false;

    if (is_filesystem) {
        add_tab(_("Filesystem"), FilesystemTab, true, ["mismounted-fsys"]);
    } else if ((content_block && content_block.IdUsage == "raid" && content_block.IdType == "LVM2_member") ||
               (block_pvol && client.vgroups[block_pvol.VolumeGroup])) {
        add_tab(_("LVM2 physical volume"), PVolTab, true);
    } else if (is_stratis) {
        add_tab(_("Stratis pool"), StratisBlockdevTab, false);
    } else if ((content_block && content_block.IdUsage == "raid") ||
               (content_block && client.mdraids[content_block.MDRaidMember])) {
        add_tab(_("RAID member"), MDRaidMemberTab, true);
    } else if (content_block && client.legacy_vdo_overlay.find_by_backing_block(content_block)) {
        add_tab(_("VDO backing"), VDOBackingTab, true);
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
        const config = client.blocks_crypto[block.path]?.ChildConfiguration.find(c => c[0] == "fstab");
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
            Title: _("Unlock $0", target_name),
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
            const config = client.blocks_crypto[block.path]?.ChildConfiguration.find(c => c[0] == "fstab");
            if (config && !content_block)
                add_action(_("Mount"), () => mounting_dialog(client, block, "mount"), _("not mounted"));
            else
                add_action(_("Unlock"), unlock, _("locked"));
        }
    }

    function activate() {
        return lvol.Activate({});
    }

    function deactivate() {
        return lvol.Deactivate({});
    }

    function create_snapshot() {
        const vgroup = lvol && client.vgroups[lvol.VolumeGroup];
        if (!vgroup)
            return;

        dialog_open({
            Title: cockpit.format(_("Create snapshot of $0/$1"), vgroup.Name, lvol.Name),
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

        const pvs_as_spaces = pvs_to_spaces(client, client.vgroups_pvols[vgroup.path].filter(usable));
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
                return cockpit.format(_("An additional $0 must be selected"), utils.fmt_size(missing - selected));
        }

        dialog_open({
            Title: cockpit.format(_("Repair logical volume $0"), lvol.Name),
            Body: <div><p>{cockpit.format(_("Select the physical volumes that should be used to repair the logical volume. At leat $0 are needed."),
                                          utils.fmt_size(missing))}</p><br /></div>,
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
        const status_code = client.lvols_status[lvol.path];
        if (status_code == "degraded" || status_code == "degraded-maybe-partial")
            add_action(_("Repair"), repair);

        if (lvol.Type != "pool") {
            if (lvol.Active) {
                add_menu_action(_("Deactivate"), deactivate);
            } else {
                add_action(_("Activate"), activate, _("not active"));
            }
        }
        if (client.lvols[lvol.ThinPool]) {
            add_menu_action(_("Create snapshot"), create_snapshot);
        }
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

        let danger;

        if (lvol) {
            danger = _("Deleting a logical volume will delete all data in it.");
        } else if (block_part) {
            danger = _("Deleting a partition will delete all data in it.");
        }

        if (target_name) {
            const usage = utils.get_active_usage(client, target.path, _("delete"));

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in use"), target_name),
                    Body: BlockingMessage(usage)
                });
                return;
            }

            dialog_open({
                Title: cockpit.format(_("Permanently delete $0?"), target_name),
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

    if (block && !options.is_extended) {
        if (is_unrecognized)
            add_danger_action(_("Format"), () => format_dialog(client, block.path));
        else
            add_menu_danger_action(_("Format"), () => format_dialog(client, block.path));
    }

    if (options.is_partition || lvol) {
        add_menu_danger_action(_("Delete"), delete_);
    }

    if (block_fsys) {
        if (is_mounted(client, content_block))
            add_menu_action(_("Unmount"), () => mounting_dialog(client, content_block, "unmount"));
        else
            add_action(_("Mount"), () => mounting_dialog(client, content_block, "mount"), _("not mounted"));
    }

    return {
        renderers: tabs,
        actions: tab_actions,
        hints: tab_hints,
        menu_actions: tab_menu_actions,
        menu_danger_actions: tab_menu_danger_actions,
        warnings
    };
}

export function block_description(client, block, options) {
    let type, used_for, link, size, critical_size;
    const block_stratis_blockdev = client.blocks_stratis_blockdev[block.path];
    const block_stratis_stopped_pool = client.blocks_stratis_stopped_pool[block.path];
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
        } else if (block_stratis_stopped_pool) {
            type = _("Stratis block device");
            used_for = block_stratis_stopped_pool;
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
            type = _("LVM2 physical volume");
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
            type = _("Stratis block device");
            used_for = pool.Name;
            link = ["pool", pool.Uuid];
            omit_encrypted_label = true;
        } else if (block.IdType == "LVM2_member") {
            type = _("LVM2 physical volume");
        } else if (block.IdType == "stratis") {
            type = _("Stratis block device");
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

    if (options.unified)
        link = null;

    return {
        type,
        used_for,
        link,
        size,
        critical_size
    };
}

function append_row(client, rows, level, key, name, desc, tabs, job_object, options) {
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
        info = <Spinner size="md" />;
    if (tabs.warnings.length > 0)
        info = <>{info}{warnings_icon(tabs.warnings)}</>;
    if (info)
        info = <>{"\n"}{info}</>;

    let location = desc.used_for;
    if (tabs.hints.length > 0) {
        const hints = "(" + tabs.hints.join(", ") + ")";
        if (location)
            location += " " + hints;
        else
            location = hints;
    }

    const cols = [
        {
            title: (
                <span key={name}>
                    {name}
                    {info}
                </span>)
        },
        { title: desc.type },
        { title: desc.link ? <Button isInline variant="link" onClick={() => cockpit.location.go(desc.link)}>{desc.used_for}</Button> : location },
        {
            title: desc.size.length
                ? <StorageUsageBar stats={desc.size} critical={desc.critical_size || 0.95} block={name} />
                : utils.fmt_size(desc.size),
            props: { className: "pf-v5-u-text-align-right" }
        },
        { title: <>{tabs.actions}{menu}</>, props: { className: "pf-v5-c-table__action content-action" } },
    ];

    rows.push({
        props: { key, className: "content-level-" + level },
        columns: cols,
        expandedContent: tabs.renderers.length > 0 ? <ListingPanel tabRenderers={tabs.renderers} /> : null,
        go: options.go
    });
}

function append_non_partitioned_block(client, rows, level, block, options) {
    const tabs = create_tabs(client, block, options);
    const desc = block_description(client, block, options);

    append_row(client, rows, level, block.path, utils.block_name(block), desc, tabs, block.path,
               { ...options, go: () => cockpit.location.go([utils.block_name(block).replace(/^\/dev\//, "")]) });
}

function append_partitions(client, rows, level, block, options) {
    const block_ptable = client.blocks_ptable[block.path];
    const device_level = level;

    const is_dos_partitioned = (block_ptable.Type == 'dos');

    function append_free_space(level, start, size) {
        function create_partition() {
            format_dialog(client, block.path, start, size, is_dos_partitioned && level <= device_level);
        }

        let btn, item, menu;

        if (options.unified) {
            btn = null;
            item = (
                <StorageMenuItem key="create"
                                 onClick={create_partition}>
                    {_("Create partition")}
                </StorageMenuItem>);
            menu = <StorageBarMenu menuItems={[item]} isKebab />;
        } else {
            btn = (
                <StorageButton onlyWide onClick={create_partition}>
                    {_("Create partition")}
                </StorageButton>);
            item = (
                <StorageMenuItem key="create"
                                 onlyNarrow
                                 onClick={create_partition}>
                    {_("Create partition")}
                </StorageMenuItem>);
            menu = <StorageBarMenu onlyNarrow menuItems={[item]} isKebab />;
        }

        const cols = [
            _("Free space"),
            { },
            { },
            { title: utils.fmt_size(size), props: { className: "pf-v5-u-text-align-right" } },
            { title: <>{btn}{menu}</>, props: { className: "pf-v5-c-table__action content-action" } },
        ];

        rows.push({
            columns: cols,
            props: {
                key: "free-space-" + rows.length.toString(),
                className: "content-level-" + level,
            },
            go: options.go,
        });
    }

    function append_extended_partition(level, partition) {
        const desc = {
            size: partition.size,
            type: _("Extended partition")
        };
        const tabs = create_tabs(client, partition.block,
                                 { is_partition: true, is_extended: true, ...options });
        append_row(client, rows, level, partition.block.path, utils.block_name(partition.block), desc, tabs, partition.block.path, options);
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
                append_non_partitioned_block(client, rows, level, p.block, { is_partition: true, ...options });
        }
    }

    process_partitions(level, utils.get_partitions(client, block));
}

function append_device(client, rows, level, block, options) {
    if (client.blocks_ptable[block.path])
        append_partitions(client, rows, level, block, options);
    else
        append_non_partitioned_block(client, rows, level, block, options);
}

export function block_content_rows(client, block, options) {
    const rows = [];
    append_device(client, rows, options.level || 0, block,
                  { go: () => utils.go_to_block(client, block.path), ...options });
    return rows;
}

function format_disk(client, block) {
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

export function block_menu_items(client, block, options) {
    function onClick() {
        if (block.ReadOnly)
            return Promise.reject(_("Device is read-only"));
        format_disk(client, block);
    }

    return [
        <StorageMenuItem danger key="disk-format" onClick={onClick}>
            {_("Create partition table")}
        </StorageMenuItem>
    ];
}

const BlockContent = ({ client, block, allow_partitions }) => {
    if (!block)
        return null;

    if (block.Size === 0)
        return null;

    let format_disk_btn = null;
    if (allow_partitions)
        format_disk_btn = (
            <StorageButton onClick={() => format_disk(client, block)}
                           excuse={block.ReadOnly ? _("Device is read-only") : null}>
                {_("Create partition table")}
            </StorageButton>
        );

    let title;
    if (client.blocks_ptable[block.path])
        title = _("Partitions");
    else
        title = _("Content");

    function onRowClick(event, row) {
        if (!event || event.button !== 0)
            return;

        // StorageBarMenu sets this to tell us not to navigate when
        // the kebabs are opened.
        if (event.defaultPrevented)
            return;

        if (row.go)
            row.go();
    }

    return (
        <Card>
            <CardHeader actions={{ actions: format_disk_btn }}>
                <CardTitle component="h2">{title}</CardTitle>
            </CardHeader>
            <CardBody className="contains-list">
                <ListingTable rows={ block_content_rows(client, block, { unified: true }) }
                              variant="compact"
                              aria-label={_("Content")}
                              onRowClick={onRowClick}
                              columns={[_("Name"), _("Type"), _("Used for"), _("Size")]}
                              showHeader={false} />
            </CardBody>
        </Card>
    );
};

export const ThinPoolContent = ({ client, pool }) => {
    const create_volume = (
        <StorageButton onClick={null}>
            {_("Create thin volume")}
        </StorageButton>
    );

    function onRowClick(event, row) {
        if (!event || event.button !== 0)
            return;

        // StorageBarMenu sets this to tell us not to navigate when
        // the kebabs are opened.
        if (event.defaultPrevented)
            return;

        if (row.go)
            row.go();
    }

    return (
        <Card>
            <CardHeader actions={{ actions: create_volume }}>
                <CardTitle component="h2">{_("Thin volumes in pool")}</CardTitle>
            </CardHeader>
            <CardBody className="contains-list">
                <ListingTable rows={ thin_pool_content_rows(client, pool, { unified: true }) }
                              variant="compact"
                              aria-label={_("Content")}
                              onRowClick={onRowClick}
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

function append_logical_volume_block(client, rows, level, block, lvol, options) {
    const desc = client.blocks_ptable[block.path]
        ? {
            size: block.Size,
            type: _("Partitioned block device"),
            used_for: utils.block_name(block),
            link: [utils.block_name(block).replace(/^\/dev\//, "")]
        }
        : block_description(client, block, options);
    const tabs = create_tabs(client, block, options);
    const vgroup = client.vgroups[lvol.VolumeGroup];
    append_row(client, rows, level, block.path, lvol.Name, desc, tabs, block.path,
               { ...options, go: () => cockpit.location.go(["vg", vgroup.Name, lvol.Name]) });
}

function append_thin_pool_volumes(client, rows, level, pool, options) {
    client.lvols_pool_members[pool.path].forEach(function (member_lvol) {
        append_logical_volume(client, rows, level + 1, member_lvol, options);
    });
}

function append_logical_volume(client, rows, level, lvol, options) {
    let tabs, desc, block;
    const vgroup = client.vgroups[lvol.VolumeGroup];

    if (lvol.Type == "pool") {
        desc = {
            size: lvol.Size,
            type: _("Pool for thin volumes")
        };
        tabs = create_tabs(client, lvol, options);
        append_row(client, rows, level, lvol.Name, lvol.Name, desc, tabs, false,
                   { ...options, go: () => cockpit.location.go(["vg", vgroup.Name, lvol.Name]) });
        append_thin_pool_volumes(client, rows, level, lvol, options);
    } else {
        block = client.lvols_block[lvol.path];
        if (block) {
            append_logical_volume_block(client, rows, level, block, lvol, options);
        } else {
            // If we can't find the block for a active
            // volume, Storaged or something below is
            // probably misbehaving, and we show it as
            // "unsupported".

            desc = {
                size: lvol.Size,
                type: lvol.Active ? _("Unsupported volume") : _("Inactive volume")
            };
            tabs = create_tabs(client, lvol, options);
            append_row(client, rows, level, lvol.Name, lvol.Name, desc, tabs, false,
                       { ...options, go: () => cockpit.location.go(["vg", vgroup.Name, lvol.Name]) });
        }
    }
}

export function thin_pool_content_rows(client, pool, options) {
    const rows = [];
    append_thin_pool_volumes(client, rows, options.level || 0, pool, options);
    return rows;
}

export function vgroup_content_rows(client, vgroup, options) {
    const rows = [];

    const isVDOPool = lvol => Object.keys(client.vdo_vols).some(v => client.vdo_vols[v].VDOPool == lvol.path);

    (client.vgroups_lvols[vgroup.path] || []).forEach(lvol => {
        // Don't display VDO pool volumes as separate entities; they are an internal implementation detail and have no actions
        if (lvol.ThinPool == "/" && lvol.Origin == "/" && !isVDOPool(lvol))
            append_logical_volume(client, rows, options.level || 0, lvol, options);
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

function create_logical_volume(client, vgroup) {
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
            title: _("Linear (at least one physical volume)"),
            min_pvs: 1,
        },
        {
            value: "raid0",
            title: _("Striped (RAID 0, at least two physical volumes)"),
            min_pvs: 2,
        },
        {
            value: "raid1",
            title: _("Mirrored (RAID 1, at least two physical volumes)"),
            min_pvs: 2,
        },
        {
            value: "raid10",
            title: _("Striped and mirrored (RAID 10, at least four physical volumes, even number)"),
            min_pvs: 4,
        },
        {
            value: "raid5",
            title: _("Distributed parity (RAID 5, at least three physical volumes)"),
            min_pvs: 3,
        },
        {
            value: "raid6",
            title: _("Double distributed parity (RAID 6, at least five physical volumes)"),
            min_pvs: 5,
        }
    ];

    const vdo_package = client.get_config("vdo_package", null);
    const need_vdo_install = vdo_package && !(client.features.lvm_create_vdo || client.features.legacy_vdo);

    if (client.features.lvm_create_vdo || client.features.legacy_vdo || vdo_package)
        purposes.push({ value: "vdo", title: _("VDO filesystem volume (compression/deduplication)") });

    const pvs_as_spaces = pvs_to_spaces(client, client.vgroups_pvols[vgroup.path].filter(pvol => pvol.FreeSize > 0));

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
            return sum;
        } else if (layout == "raid0" && n_pvs >= 2) {
            return n_pvs * min;
        } else if (layout == "raid1" && n_pvs >= 2) {
            return min - metasize(min);
        } else if (layout == "raid10" && n_pvs >= 4) {
            return Math.floor(n_pvs / 2) * (min - metasize(min));
        } else if ((layout == "raid4" || layout == "raid5") && n_pvs >= 3) {
            return (n_pvs - 1) * (min - metasize(min));
        } else if (layout == "raid6" && n_pvs >= 5) {
            return (n_pvs - 2) * (min - metasize(min));
        } else
            return 0; // not-covered: internal error
    }

    const layout_descriptions = {
        linear: _("Data will be stored on the selected physical volumes without any additional redundancy or performance improvements."),
        raid0: _("Data will be stored on the selected physical volumes in an alternating fashion to improve performance. At least two volumes need to be selected."),
        raid1: _("Data will be stored as two or more copies on the selected physical volumes, to improve reliability. At least two volumes need to be selected."),
        raid10: _("Data will be stored as two copies and also in an alternating fashion on the selected physical volumes, to improve both reliability and performance. At least four volumes need to be selected."),
        raid4: _("Data will be stored on the selected physical volumes so that one of them can be lost without affecting the data. At least three volumes need to be selected."),
        raid5: _("Data will be stored on the selected physical volumes so that one of them can be lost without affecting the data. Data is also stored in an alternating fashion to improve performance. At least three volumes need to be selected."),
        raid6: _("Data will be stored on the selected physical volumes so that up to two of them can be lost at the same time without affecting the data. Data is also stored in an alternating fashion to improve performance. At least five volumes need to be selected."),
    };

    for (const lay of layouts)
        lay.disabled = pvs_as_spaces.length < lay.min_pvs;

    function min_pvs_explanation(pvs, min) {
        if (pvs.length <= min)
            return cockpit.format(_("All $0 selected physical volumes are needed for the choosen layout."),
                                  pvs.length);
        return null;
    }

    dialog_open({
        Title: cockpit.format(_("Create logical volume in $0"), vgroup.Name),
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
            SelectSpaces("pvs", _("Physical Volumes"),
                         {
                             spaces: pvs_as_spaces,
                             value: pvs_as_spaces,
                             visible: vals => can_do_layouts && vals.purpose === 'block',
                             min_selected: 1,
                             validate: (val, vals) => {
                                 if (vals.layout == "raid10" && (vals.pvs.length % 2) !== 0)
                                     return _("RAID10 needs an even number of physical volumes");
                             },
                             explanation: min_pvs_explanation(pvs_as_spaces, 1)
                         }),
            SelectOne("layout", _("Layout"),
                      {
                          value: "linear",
                          choices: layouts,
                          visible: vals => can_do_layouts && vals.purpose === 'block',
                          explanation: layout_descriptions.linear
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
                for (const lay of layouts) {
                    lay.disabled = (vals.pvs.length < lay.min_pvs);
                    if (lay.value == vals.layout) {
                        dlg.set_options("pvs", {
                            min_selected: lay.min_pvs,
                            explanation: min_pvs_explanation(vals.pvs, lay.min_pvs)
                        });
                    }
                }
                dlg.set_options("layout",
                                {
                                    choices: layouts,
                                    explanation: layout_descriptions[vals.layout]
                                });
                const max = max_size(vals);
                const old_max = dlg.get_options("size").max;
                if (vals.size > max || vals.size == old_max)
                    dlg.set_values({ size: max });
                dlg.set_options("size", { max });
            } else if (trigger == "purpose") {
                dlg.set_options("size", { max: vgroup.FreeSize });
            }
        },
        Action: {
            Title: _("Create"),
            action: (vals, progress) => {
                if (vals.purpose == "block") {
                    if (!can_do_layouts)
                        return vgroup.CreatePlainVolume(vals.name, vals.size, { });
                    else {
                        return vgroup.CreatePlainVolumeWithLayout(vals.name, vals.size, vals.layout,
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

export function vgroup_menu_items(client, vgroup, options) {
    function onClick() {
        if (vgroup.FreeSize == 0)
            return Promise.reject(_("No free space"));
        create_logical_volume(client, vgroup);
    }

    return [
        <StorageMenuItem key="vgroup-create" onClick={onClick}>
            {_("Create logical volume")}
        </StorageMenuItem>,
        <StorageMenuItem key="vgroup-rename" onClick={() => vgroup_rename(client, vgroup)}>
            {_("Rename volume group")}
        </StorageMenuItem>,
        <StorageMenuItem key="vgroup-rename" danger onClick={() => vgroup_delete(client, vgroup)}>
            {_("Delete volume group")}
        </StorageMenuItem>,
    ];
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
        const vgroup = this.props.vgroup;
        const client = this.props.client;

        let excuse = null;
        if (vgroup.MissingPhysicalVolumes && vgroup.MissingPhysicalVolumes.length > 0)
            excuse = _("New logical volumes can not be created while a volume group is missing physical volumes.");
        else if (vgroup.FreeSize == 0)
            excuse = _("No free space");

        const new_volume_link = (
            <StorageButton onClick={() => create_logical_volume(client, vgroup)}
                           excuse={excuse}>
                {_("Create new logical volume")}
            </StorageButton>
        );

        function onRowClick(event, row) {
            if (!event || event.button !== 0)
                return;

            // StorageBarMenu sets this to tell us not to navigate when
            // the kebabs are opened.
            if (event.defaultPrevented)
                return;

            if (row.go)
                row.go();
        }

        return (
            <Card>
                <CardHeader actions={{ actions: new_volume_link }}>
                    <CardTitle component="h2">{_("Logical volumes")}</CardTitle>
                </CardHeader>
                <CardBody className="contains-list">
                    <ListingTable emptyCaption={_("No logical volumes")}
                                  variant="compact"
                                  aria-label={_("Logical volumes")}
                                  onRowClick={onRowClick}
                                  columns={[_("Name"), _("Type"), _("Used for"), _("Size")]}
                                  showHeader={false}
                                  rows={vgroup_content_rows(client, vgroup, { unified: true })} />
                </CardBody>
            </Card>
        );
    }
}
