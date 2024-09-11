/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import client from "../client";

import { format_disk } from "./format-disk-dialog.jsx";
import { format_dialog } from "./format-dialog.jsx";

const _ = cockpit.gettext;

export function block_actions(block, partitionable) {
    if (!block || block.Size === 0)
        return [];

    const excuse = block.ReadOnly ? _("Device is read-only") : null;
    const actions = [];

    if (partitionable)
        actions.push({
            title: _("Create partition table"),
            action: () => format_disk(block),
            danger: true,
            excuse,
        });

    actions.push({
        title: _("Format"),
        action: () => format_dialog(client, block.path),
        danger: true,
        excuse,
    });

    return actions;
}

export function partitionable_block_actions(block) {
    return block_actions(block, true);
}
