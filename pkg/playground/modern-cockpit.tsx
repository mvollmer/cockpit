/*
 * Copyright (C) 2025 Red Hat, Inc.
 *
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useState, useEffect } from "react";
import { createRoot } from 'react-dom/client';

import { Channel } from 'cockpit/channel';

/* A minimal page that uses the modern 'cockpit/channel' API without
   loading the old 'cockpit' module.  It is used to test that such a
   minimal page also has a session manager (without doing anything
   itself to get one) and thus interacts correctly with the sesion
   timeouts enforced by the bridge.
 */

const Demo = () => {
    const [hostname, setHostname] = useState("");

    useEffect(() => {
        const ch = new Channel({ payload: "stream", spawn: ["hostname"] });
        ch.on("data", data => setHostname(data.trim()));
    }, []);

    return (
        <div id="hostname">{hostname}</div>
    );
};

document.addEventListener("DOMContentLoaded", async function() {
    createRoot(document.getElementById('app')!).render(<Demo />);
});
