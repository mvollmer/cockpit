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
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { ActionButtons, block_location, new_container } from "../pages.jsx";
import { block_name, drive_name, format_temperature, fmt_size_long } from "../utils.js";
import { format_disk } from "../content-views.jsx"; // XXX

import { make_block_pages, make_block_page } from "../create-pages.jsx";

const _ = cockpit.gettext;

export function partitionable_block_actions(block, tag) {
    const is_formatted = !client.blocks_available[block.path];
    const excuse = block.ReadOnly ? _("Device is read-only") : null;

    return [
        (block.Size > 0
            ? {
                title: _("Create partition table"),
                action: () => format_disk(client, block),
                danger: is_formatted,
                excuse,
                tag
            }
            : null)
    ];
}

export function make_partitionable_block_pages(parent, block) {
    const is_formatted = !client.blocks_available[block.path];

    if (is_formatted)
        make_block_pages(parent, block, null);
}

export function make_drive_page(parent, drive) {
    let block = client.drives_block[drive.path];

    if (!block) {
        // A drive without a primary block device might be
        // a unconfigured multipath device.  Try to hobble
        // along here by arbitrarily picking one of the
        // multipath devices.
        block = client.drives_multipath_blocks[drive.path][0];
    }

    if (!block)
        return;

    const container = make_drive_container(null, drive, block);
    make_block_page(parent, block, container);
}

function make_drive_container(parent, drive, block) {
    const cont = new_container({
        parent,
        page_location: ["drive", block_location(block)],
        id_extra: drive_name(drive),
        component: DriveContainer,
        props: { drive },
        actions: partitionable_block_actions(block),
    });
    return cont;
}

const DriveContainer = ({ container, drive }) => {
    const block = client.drives_block[drive.path];
    const drive_ata = client.drives_ata[drive.path];
    const multipath_blocks = client.drives_multipath_blocks[drive.path];

    let assessment = null;
    if (drive_ata) {
        assessment = (
            <SDesc title={_("Assessment")}>
                <Flex spaceItems={{ default: 'spaceItemsXs' }}>
                    { drive_ata.SmartFailing
                        ? <span className="cockpit-disk-failing">{_("Disk is failing")}</span>
                        : <span>{_("Disk is OK")}</span>
                    }
                    { drive_ata.SmartTemperature > 0
                        ? <span>({format_temperature(drive_ata.SmartTemperature)})</span>
                        : null
                    }
                </Flex>
            </SDesc>);
    }

    return (
        <SCard title={_("Drive")} actions={<ActionButtons container={container} />}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <SDesc title={_("Model")} value={drive.Model} />
                    <SDesc title={_("Firmware version")} value={drive.Revision} />
                    <SDesc title={_("Serial number")} value={drive.Serial} />
                    <SDesc title={_("World wide name")} value={drive.WWN} />
                    <SDesc title={_("Capacity")}>
                        {drive.Size
                            ? fmt_size_long(drive.Size)
                            : _("No media inserted")
                        }
                    </SDesc>
                    { assessment }
                    <SDesc title={_("Device file")}
                           value={block ? block_name(block) : "-"} />
                    { multipath_blocks.length > 0 &&
                    <SDesc title={_("Multipathed devices")}
                             value={multipath_blocks.map(block_name).join(" ")} />
                    }
                </DescriptionList>
            </CardBody>
        </SCard>
    );
};
