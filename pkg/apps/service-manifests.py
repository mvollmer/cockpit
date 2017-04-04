#! /usr/bin/python -Es

import xml.etree.ElementTree as ET
import json
import sys
import glob

tools = { }

for file in glob.glob("/usr/share/metainfo/*.xml"):
    root = ET.parse(file).getroot()
    if root.tag == 'component' and root.attrib['type'] == 'service':
        id = root.find('id')
        name = root.find('name')
        tools['ui#/' + id.text] = { 'label': name.text }

manifests = { 'apps': { 'tools': tools } }

sys.stdout.write(json.dumps(manifests) + "\n")
