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

import {
    new_page, ActionButtons, page_type,
} from "../pages.jsx";
import { lvm2_delete_logical_volume_dialog, lvm2_create_snapshot_action } from "./lvm2-volume-group.jsx";
import { SCard } from "../utils/card.jsx";
import { StorageSize } from "../storage-controls.jsx";

const _ = cockpit.gettext;

export function make_lvm2_inactive_logical_volume_page(parent, vgroup, lvol, container) {
    const page = new_page({
        location: ["vg", vgroup.Name, lvol.Name],
        parent,
        container,
        name: lvol.Name,
        columns: [
            _("Inactive logical volume"),
            null,
            <StorageSize key="s" size={lvol.Size} />,
        ],
        component: LVM2InactiveLogicalVolumePage,
        props: { vgroup, lvol },
        actions: [
            { title: _("Activate"), action: () => lvol.Activate({}) },
            lvm2_create_snapshot_action(lvol),
            { title: _("Delete"), action: () => lvm2_delete_logical_volume_dialog(lvol, page), danger: true },
        ]
    });
}

export const LVM2InactiveLogicalVolumePage = ({ page, vgroup, lvol }) => {
    return <SCard title={page_type(page)} action={<ActionButtons page={page} /> } />;
};
