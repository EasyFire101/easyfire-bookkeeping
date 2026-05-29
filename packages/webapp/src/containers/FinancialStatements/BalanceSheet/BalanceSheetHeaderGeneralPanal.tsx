import React from 'react';

import { Row, Col } from '@/components';

import { RadiosAccountingBasis } from '../RadiosAccountingBasis';
import { SelectDisplayColumnsBy } from '../SelectDisplayColumnsBy';
import { FinancialStatementDateRange } from '../FinancialStatementDateRange';
import { FinancialStatementsFilter } from '../FinancialStatementsFilter';

export function BalanceSheetHeaderGeneralPanal() {
  return (
    <div>
      <FinancialStatementDateRange />
      <SelectDisplayColumnsBy />

      <Row>
        <Col xs={4}>
          <FinancialStatementsFilter initialSelectedItem={'all-accounts'} />
        </Col>
      </Row>
      <RadiosAccountingBasis key={'basis'} />
    </div>
  );
}
