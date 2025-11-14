/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2025 Red Hat, Inc.
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

import React from "react";

import { Page, PageProps } from "@patternfly/react-core/dist/esm/components/Page/index.js";

import '../patternfly/patternfly-6-cockpit.scss';
import 'cockpit-dark-theme'; // once per page
import 'page.scss';

export const CockpitPage = ({
    className,
    ...props
} : {
    className?: string | undefined,
} & Omit<PageProps, "ref" | "className">) => (
    <Page
        isContentFilled
        className={"no-masthead-sidebar " + (className || "")}
        {...props}
    />
);
