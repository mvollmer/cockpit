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

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import {
    ParentPageLink, PageContainerStackItems,
    new_page, block_location, ActionButtons, page_type,
    register_crossref,
} from "../pages.jsx";
import { format_dialog } from "../format-dialog.jsx";
import { block_name, fmt_size } from "../utils.js";
import { std_lock_action } from "../actions.jsx";
import { StorageSize, StorageUsageBar } from "../storage-controls.jsx";

const _ = cockpit.gettext;

/* XXX - Unlike for make_filesystem_page, "content_block" is never null.
 */

export function make_lvm2_physical_volume_page(parent, backing_block, content_block, container) {
    const block_pvol = client.blocks_pvol[content_block.path];
    const vgroup = block_pvol && client.vgroups[block_pvol.VolumeGroup];

    const p = new_page({
        location: [block_location(backing_block)],
        parent,
        container,
        name: block_name(backing_block),
        columns: [
            _("LVM2 physical volume"),
            vgroup ? vgroup.Name : null,
            (block_pvol
                ? <StorageUsageBar key="s" stats={[block_pvol.Size - block_pvol.FreeSize, block_pvol.Size]} short />
                : <StorageSize key="s" size={backing_block.Size} />),
        ],
        component: LVM2PhysicalVolumePage,
        props: { backing_block, content_block },
        actions: [
            std_lock_action(backing_block, content_block),
            { title: _("Format"), action: () => format_dialog(client, backing_block.path), danger: true },
        ]
    });

    function pvol_remove() {
        return vgroup.RemoveDevice(block_pvol.path, true, {});
    }

    function pvol_empty_and_remove() {
        return (vgroup.EmptyDevice(block_pvol.path, {})
                .then(function() {
                    vgroup.RemoveDevice(block_pvol.path, true, {});
                }));
    }

    if (vgroup) {
        const pvols = client.vgroups_pvols[vgroup.path] || [];
        let remove_action = null;
        let remove_excuse = null;

        if (vgroup.MissingPhysicalVolumes && vgroup.MissingPhysicalVolumes.length > 0) {
            remove_excuse = _("Physical volumes can not be removed while a volume group is missing physical volumes.");
        } else if (pvols.length === 1) {
            remove_excuse = _("The last physical volume of a volume group cannot be removed.");
        } else if (block_pvol.FreeSize < block_pvol.Size) {
            if (block_pvol.Size <= vgroup.FreeSize)
                remove_action = pvol_empty_and_remove;
            else
                remove_excuse = cockpit.format(
                    _("There is not enough free space elsewhere to remove this physical volume. At least $0 more free space is needed."),
                    fmt_size(block_pvol.Size - vgroup.FreeSize)
                );
        } else {
            remove_action = pvol_remove;
        }

        register_crossref({
            key: vgroup,
            page: p,
            actions: [
                {
                    title: _("Remove"),
                    action: remove_action,
                    excuse: remove_excuse,
                },
            ],
            size: <StorageUsageBar stats={[block_pvol.Size - block_pvol.FreeSize, block_pvol.Size]} short />,
            extra: content_block.IdUUID,
        });
    }
}

export const LVM2PhysicalVolumePage = ({ page, backing_block, content_block }) => {
    const block_pvol = client.blocks_pvol[content_block.path];
    const vgroup = block_pvol && client.vgroups[block_pvol.VolumeGroup];

    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Stored on")}>
                                <ParentPageLink page={page} />
                            </SDesc>
                            <SDesc title={_("Volume group")}>
                                {vgroup
                                    ? <Button variant="link" isInline role="link"
                                           onClick={() => cockpit.location.go(["vg", vgroup.Name])}>
                                        {vgroup.Name}
                                    </Button>
                                    : "-"
                                }
                            </SDesc>
                            <SDesc title={_("UUID")} value={content_block.IdUUID} />
                            { block_pvol &&
                            <SDesc title={_("Usage")}>
                                <StorageUsageBar key="s"
                                                   stats={[block_pvol.Size - block_pvol.FreeSize,
                                                       block_pvol.Size]} />
                            </SDesc>
                            }
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <PageContainerStackItems page={page} />
        </Stack>);
};
