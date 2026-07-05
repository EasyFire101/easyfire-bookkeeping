// @ts-nocheck
import { Tab } from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import styled from 'styled-components';
import { WarehouseTransferDetailActionsBar } from './WarehouseTransferDetailActionsBar';
import { WarehouseTransferDetailPanel } from './WarehouseTransferDetailPanel';
import { DrawerMainTabs } from '@/components';

/**
 * Warehouse transfer view detail.
 * @returns {React.JSX}
 */
export function WarehouseTransferDetail() {
  return (
    <WarehouseTransferRoot>
      <WarehouseTransferDetailActionsBar />
      <WarehouseTransferDetailsTabs />
    </WarehouseTransferRoot>
  );
}

/**
 * Warehouse transfer details tabs.
 * @returns {React.JSX}
 */
function WarehouseTransferDetailsTabs() {
  return (
    <DrawerMainTabs>
      <Tab
        title={intl.get('details')}
        id={'details'}
        panel={<WarehouseTransferDetailPanel />}
      />
    </DrawerMainTabs>
  );
}

const WarehouseTransferRoot = styled.div``;
