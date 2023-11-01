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
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { PageChildrenCard, PageContainerStackItems, ParentPageLink, ActionButtons, new_page, page_type, block_location } from "../pages.jsx";
import { block_name, drive_name, format_temperature, fmt_size_long } from "../utils.js";
import { format_disk, erase_disk } from "../content-views.jsx"; // XXX
import { format_dialog } from "../format-dialog.jsx";
import { StorageSize } from "../storage-controls.jsx";

import { make_block_pages } from "../create-pages.jsx";

const _ = cockpit.gettext;

export function make_partition_table_page(parent, block, container) {
    const block_ptable = client.blocks_ptable[block.path]
    const excuse = block.ReadOnly ? _("Device is read-only") : null;

    const p = new_page({
        location: [block_location(block)],
        parent,
        container,
        name: block_name(block),
        columns: [
            _("Partition table"),
            null,
            <StorageSize key="s" size={block.Size} />,
        ],
        component: PartitionTablePage,
        props: { block, block_ptable },
        actions: [
            {
                title: _("Erase"),
                action: () => erase_disk(client, block),
                danger: true,
                excuse,
            }
        ]
    });

    make_block_pages(p, block);
}

const PartitionTablePage = ({ page, block, block_ptable }) => {
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Stored on")}>
                                <ParentPageLink page={page} />
                            </SDesc>
                            <SDesc title={_("Type")} value={block_ptable.Type} />
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <StackItem>
                <PageChildrenCard title={_("Partitions")} page={page} />
            </StackItem>
            <PageContainerStackItems page={page} />
        </Stack>
    );
};
