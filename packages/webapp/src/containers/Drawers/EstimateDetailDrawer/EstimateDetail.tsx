import styled from 'styled-components';
import intl from 'react-intl-universal';
import { Tab } from '@blueprintjs/core';

import { DrawerMainTabs } from '@/components';

import { EstimateDetailActionsBar } from './EstimateDetailActionsBar';
import { EstimateDetailTab as EstimateDetailPanel } from './EstimateDetailPanel';

/**
 * Estimate details tabs.
 */
function EstimateDetailsTabs() {
  return (
    <DrawerMainTabs>
      <Tab
        title={intl.get('details')}
        id={'details'}
        panel={<EstimateDetailPanel />}
      />
    </DrawerMainTabs>
  );
}

/**
 * Estimate view detail
 */
export function EstimateDetail() {
  return (
    <EstimateDetailsRoot>
      <EstimateDetailActionsBar />
      <EstimateDetailsTabs />
    </EstimateDetailsRoot>
  );
}

const EstimateDetailsRoot = styled.div``;
