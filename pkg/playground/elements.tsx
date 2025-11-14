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

import cockpit from "cockpit";
import React from "react";
import { createRoot, Container } from 'react-dom/client';

import { PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Card, CardTitle, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";

import { CockpitPage } from 'cockpit/elements';

const LongList = () => {
    const res = [];
    for (let i = 0; i < 100; i++)
        res.push(<div key={i}>{Math.random()}</div>);
    return res;
};

const ElementsDemo = () => {
    return (
        <CockpitPage>
            <PageSection>
                Header, filters, kebabs, breadcrumbs
            </PageSection>
            <PageSection hasOverflowScroll isFilled>
                <Card>
                    <CardTitle>Card 1</CardTitle>
                    <CardBody>
                        <LongList />
                    </CardBody>
                </Card>
                <br />
                <Card>
                    <CardTitle>Card 2</CardTitle>
                    <CardBody>
                        <LongList />
                    </CardBody>
                </Card>
            </PageSection>
            <PageSection>
                Footer
            </PageSection>
        </CockpitPage>
    );
};

function init_app(rootElement: Container) {
    const root = createRoot(rootElement);
    root.render(<ElementsDemo />);
}

document.addEventListener("DOMContentLoaded", function() {
    cockpit.transport.wait(function() {
        init_app(document.getElementById('app')!);
    });
});
