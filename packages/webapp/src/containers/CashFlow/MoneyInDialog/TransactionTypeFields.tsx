// @ts-nocheck
import React, { useMemo } from 'react';
import classNames from 'classnames';
import {

  FAccountsSuggestField,
  FieldRequiredHint,
  Col,
  Row,
  FFormGroup,
  FSelect,
} from '@/components';
import { CLASSES, getAddMoneyInOptions } from '@/constants';

import { useMoneyInDailogContext } from './MoneyInDialogProvider';
import intl from 'react-intl-universal';

/**
 * Transaction type fields.
 */
export function TransactionTypeFields() {
  // Money in dialog context.
  const { cashflowAccounts, setAccountId, accountId } = useMoneyInDailogContext();

  // Retrieves the add money in button options.
  const addMoneyInOptions = useMemo(() => getAddMoneyInOptions(), []);

  return (
    <div className="trasnaction-type-fileds">
      <Row>
        <Col xs={5}>
          {/*------------ Transaction type -----------*/}
          <FFormGroup
            name={'transaction_type'}
            label={intl.get('transaction_type')}
            labelInfo={<FieldRequiredHint />}
          >
            <FSelect
              name={'transaction_type'}
              items={addMoneyInOptions}
              popoverProps={{ minimal: true }}
              valueAccessor={'value'}
              textAccessor={'name'}
            />
          </FFormGroup>
        </Col>

        <Col xs={5}>
          {/*------------ Current account -----------*/}
          <FFormGroup
            name={'cashflow_account_id'}
            label={intl.get('cash_flow_transaction.label_current_account')}
            labelInfo={<FieldRequiredHint />}
            fill
          >
            <FAccountsSuggestField
              name={'cashflow_account_id'}
              items={cashflowAccounts}
              onItemChange={(value) => {
                setAccountId(value);
              }}
            />
          </FFormGroup>
        </Col>
      </Row>
    </div>
  );
}
