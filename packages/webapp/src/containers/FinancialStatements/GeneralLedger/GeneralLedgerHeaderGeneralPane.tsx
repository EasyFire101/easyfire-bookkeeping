import React from 'react';
import { Classes } from '@blueprintjs/core';
import intl from 'react-intl-universal';
import { AccountsMultiSelect, Row, Col, FFormGroup } from '@/components';
import { RadiosAccountingBasis } from '../RadiosAccountingBasis';
import { FinancialStatementsFilter } from '../FinancialStatementsFilter';
import { FinancialStatementDateRange } from '../FinancialStatementDateRange';
import { filterAccountsOptions } from './common';
import { useGLGeneralPanelContext } from './GLHeaderGeneralPaneProvider';
import { GLHeaderGeneralPanelProvider } from './GLHeaderGeneralPaneProvider';

/**
 * General ledger (GL) - Header - General panel.
 */
export function GLHeaderGeneralPane() {
  return (
    <GLHeaderGeneralPanelProvider>
      <GLHeaderGeneralPaneContent />
    </GLHeaderGeneralPanelProvider>
  );
}

/**
 * General ledger (GL) - Header - General panel - content.
 */
function GLHeaderGeneralPaneContent() {
  const { accounts } = useGLGeneralPanelContext();

  if (!accounts) {
    return null;
  }

  return (
    <React.Fragment>
      <FinancialStatementDateRange />

      <Row>
        <Col xs={4}>
          <FinancialStatementsFilter
            items={filterAccountsOptions}
            initialSelectedItem={'with-transactions'}
          />
        </Col>
      </Row>
      <Row>
        <Col xs={4}>
          <FFormGroup
            label={intl.get('specific_accounts')}
            name={'accountsIds'}
            className={Classes.FILL}
          >
            <AccountsMultiSelect name="accountsIds" items={accounts} />
          </FFormGroup>
        </Col>
      </Row>

      <RadiosAccountingBasis key={'basis'} />
    </React.Fragment>
  );
}
