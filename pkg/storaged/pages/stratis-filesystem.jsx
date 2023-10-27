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
import client from "../client";

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import {
    dialog_open, TextInput, CheckBoxes, SelectOne, BlockingMessage, TeardownMessage,
    init_active_usage_processes,
} from "../dialog.jsx";
import { StorageUsageBar } from "../storage-controls.jsx";
import {
    ParentPageLink, PageContainerStackItems,
    new_page, ActionButtons, page_type,
    navigate_away_from_page,
} from "../pages.jsx";
import { is_valid_mount_point, is_mounted, mounting_dialog, get_fstab_config } from "../fsys-tab.jsx"; // XXX
import { fmt_size, get_active_usage, teardown_active_usage } from "../utils.js";
import { std_reply } from "../stratis-utils.js";
import { validate_fs_name, set_mount_options, destroy_filesystem } from "./stratis-pool.jsx"; // XXX
import { mount_explanation } from "../format-dialog.jsx";
import { MountPoint, MismountAlert, check_mismounted_fsys } from "./filesystem.jsx";

const _ = cockpit.gettext;

export function make_stratis_filesystem_page(parent, pool, fsys,
    offset, forced_options, managed_fsys_sizes) {
    const filesystems = client.stratis_pool_filesystems[pool.path];
    const stats = client.stratis_pool_stats[pool.path];
    const block = client.slashdevs_block[fsys.Devnode];

    if (!block)
        return;

    const fstab_config = get_fstab_config(block);
    const [, mount_point] = fstab_config;
    const fs_is_mounted = is_mounted(client, block);

    const mismount_warning = check_mismounted_fsys(block, block, fstab_config);

    function mount() {
        return mounting_dialog(client, block, "mount", forced_options);
    }

    function unmount() {
        return mounting_dialog(client, block, "unmount", forced_options);
    }

    function rename_fsys() {
        dialog_open({
            Title: _("Rename filesystem"),
            Fields: [
                TextInput("name", _("Name"),
                          {
                              value: fsys.Name,
                              validate: name => validate_fs_name(fsys, name, filesystems)
                          })
            ],
            Action: {
                Title: _("Rename"),
                action: function (vals) {
                    return fsys.SetName(vals.name).then(std_reply);
                }
            }
        });
    }

    function snapshot_fsys() {
        if (managed_fsys_sizes && stats.pool_free < Number(fsys.Size)) {
            dialog_open({
                Title: _("Not enough space"),
                Body: cockpit.format(_("There is not enough space in the pool to make a snapshot of this filesystem. At least $0 are required but only $1 are available."),
                                     fmt_size(Number(fsys.Size)), fmt_size(stats.pool_free))
            });
            return;
        }

        dialog_open({
            Title: cockpit.format(_("Create a snapshot of filesystem $0"), fsys.Name),
            Fields: [
                TextInput("name", _("Name"),
                          {
                              value: "",
                              validate: name => validate_fs_name(null, name, filesystems)
                          }),
                TextInput("mount_point", _("Mount point"),
                          {
                              validate: (val, values, variant) => {
                                  return is_valid_mount_point(client, null, val, variant == "nomount");
                              }
                          }),
                CheckBoxes("mount_options", _("Mount options"),
                           {
                               value: {
                                   ro: false,
                                   extra: false
                               },
                               fields: [
                                   { title: _("Mount read only"), tag: "ro" },
                                   { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                               ]
                           }),
                SelectOne("at_boot", _("At boot"),
                          {
                              value: "nofail",
                              explanation: mount_explanation.nofail,
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
                          }),
            ],
            update: function (dlg, vals, trigger) {
                if (trigger == "at_boot")
                    dlg.set_options("at_boot", { explanation: mount_explanation[vals.at_boot] });
            },
            Action: {
                Title: _("Create snapshot and mount"),
                Variants: [{ tag: "nomount", Title: _("Create snapshot only") }],
                action: function (vals) {
                    return pool.SnapshotFilesystem(fsys.path, vals.name)
                            .then(std_reply)
                            .then(result => {
                                if (result[0])
                                    return set_mount_options(result[1], vals, forced_options);
                                else
                                    return Promise.resolve();
                            });
                }
            }
        });
    }

    function delete_fsys() {
        console.log("DELETE");

        const usage = get_active_usage(client, block.path, _("delete"));

        if (usage.Blocking) {
            dialog_open({
                Title: cockpit.format(_("$0 is in use"),
                                      fsys.Name),
                Body: BlockingMessage(usage)
            });
            return;
        }

        dialog_open({
            Title: cockpit.format(_("Confirm deletion of $0"), fsys.Name),
            Teardown: TeardownMessage(usage),
            Action: {
                Danger: _("Deleting a filesystem will delete all data in it."),
                Title: _("Delete"),
                action: async function () {
                    await teardown_active_usage(client, usage);
                    await destroy_filesystem(fsys);
                    console.log("NAVIGATING");
                    navigate_away_from_page(page);
                }
            },
            Inits: [
                init_active_usage_processes(client, usage)
            ]
        });
    }

    let mp_text;
    if (mount_point && fs_is_mounted)
        mp_text = mount_point;
    else if (mount_point && !fs_is_mounted)
        mp_text = mount_point + " " + _("(not mounted)");
    else
        mp_text = _("(not mounted)");

    const page = new_page({
        location: ["pool", pool.Name, fsys.Name],
        parent,
        name: fsys.Name,
        columns: [
            _("Stratis filesystem"),
            mp_text,
            (!managed_fsys_sizes
                ? <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])), stats.pool_total]}
                                critical={1} total={stats.fsys_total_used} offset={offset} />
                : <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])), Number(fsys.Size)]}
                                critical={0.95} />)
        ],
        has_warning: !!mismount_warning,
        component: StratisFilesystemPage,
        props: { pool, fsys, fstab_config, forced_options, managed_fsys_sizes, mismount_warning },
        actions: [
            (fs_is_mounted
                ? { title: _("Unmount"), action: unmount }
                : { title: _("Mount"), action: mount }),
            { title: _("Rename"), action: rename_fsys },
            { title: _("Snapshot"), action: snapshot_fsys },
            { title: _("Delete"), action: delete_fsys, danger: true },
        ]
    });
}

const StratisFilesystemPage = ({
    page, pool, fsys, fstab_config, forced_options, managed_fsys_sizes, mismount_warning,
}) => {
    const block = client.slashdevs_block[fsys.Devnode];

    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Stored on")}>
                                <ParentPageLink page={page} />
                            </SDesc>
                            <SDesc title={_("Name")} value={fsys.Name} />
                            <SDesc title={_("Mount point")}>
                                <MountPoint fstab_config={fstab_config} forced_options={forced_options}
                                            backing_block={block} content_block={block} />
                            </SDesc>
                        </DescriptionList>
                    </CardBody>
                    { mismount_warning &&
                    <CardBody>
                        <MismountAlert warning={mismount_warning}
                                         fstab_config={fstab_config} forced_options={forced_options}
                                         backing_block={block} content_block={block} />
                    </CardBody>
                    }
                </SCard>
            </StackItem>
            <PageContainerStackItems page={page} />
        </Stack>);
};
