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
import { PageContainerStackItems, PageTable, new_page, page_type, new_container, block_location } from "../pages.jsx";
import { block_name } from "../utils.js";
import { StorageSize } from "../storage-controls.jsx";

import { make_block_pages } from "../create-pages.jsx";

const _ = cockpit.gettext;

export function make_partition_table_page(parent, block, container) {
    const block_ptable = client.blocks_ptable[block.path];
    const p = new_page({
        location: [block_location(block)],
        parent,
        container: make_partition_table_container(container, block, block_ptable),
        name: block_name(block),
        columns: [
            _("Partitions"),
            null,
            <StorageSize key="s" size={block.Size} />,
        ],
        component: PartitionTablePage,
        props: { block, block_ptable },
    });

    make_block_pages(p, block);
}

function make_partition_table_container(parent, block, block_ptable) {
    return new_container({
        parent,
        component: PartitionTableContainer,
        props: { block, block_ptable },
    });
}

const PartitionTablePage = ({ page, block, block_ptable }) => {
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)}>
                    <CardBody className="contains-list">
                        <PageTable emptyCaption={_("No partitions found")}
                                   aria-label={_("Partitions")}
                                   pages={page.children} />
                    </CardBody>
                </SCard>
            </StackItem>
            <PageContainerStackItems page={page} />
        </Stack>
    );
};

const PartitionTableContainer = ({ container, block, block_ptable }) => {
    return (
        <SCard title={_("Partition table")}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <SDesc title={_("Table type")} value={block_ptable.Type} />
                </DescriptionList>
            </CardBody>
        </SCard>);
};
