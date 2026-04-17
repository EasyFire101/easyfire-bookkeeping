// @ts-nocheck
import { Tab, Tabs } from "@blueprintjs/core";
import { Card, Group } from "@/components";
import { useState } from "react";
import { css } from '@emotion/css';
import { ItemFormFloatingActions } from "./ItemFormFloatingActions";
import { ItemFormSections } from "./ItemFormFields";

export function ItemFormContent() {
  const [selectedTabId, setSelectedTabId] = useState('primary');

  const handleTabChange = (tabId) => {
    const sectionId = String(tabId);
    setSelectedTabId(sectionId);

    const section = document.querySelector(
      `[data-section-id="${sectionId}"]`,
    );
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <Card className={css`padding-bottom: 0 !important;`}>
      <Group verticalAlign={'top'} alignItems={'flex-start'} flexWrap={'nowrap'}>
        <Tabs
          selectedTabId={selectedTabId}
          onChange={handleTabChange}
          className={css`position: sticky; top: 20px;`}
          vertical
        >
          <Tab id={'primary'} title={'Basic'} />
          <Tab id={'selling'} title={'Selling'} />
          <Tab id={'purchasing'} title={'Purchasing'} />
          <Tab id={'inventory'} title={'Inventory'} />
        </Tabs>

        <ItemFormSections />
      </Group>
      <ItemFormFloatingActions />
    </Card>
  )
}
