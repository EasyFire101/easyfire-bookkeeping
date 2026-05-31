// @ts-nocheck
import React, { useMemo } from 'react';
import classNames from 'classnames';
import {

  FAccountsSuggestField,
  FieldRequiredHint,
  Col,
  Row,
  FSelect,
  FFormGroup,
} from '@/components';
import { getAddMoneyOutOptions } from '@/constants/cashflowOptions';
import { useMoneyOutDialogContext } from './MoneyOutDialogProvider';
import { CLASSES } from '@/constants/classes';
import intl from 'react-intl-universal';

/**
 * Transaction type fields.
 */
export function TransactionTypeFields() {
  // Money in dialog context.
  const { cashflowAccounts } = useMoneyOutDialogContext();

  const addMoneyOutOptions = useMemo(() => getAddMoneyOutOptions(), []);

  // Money in dialog context.
  const { defaultAccountId, setAccountId } = useMoneyOutDialogContext();

  // Cannot continue if the default account id is defined.
  if (defaultAccountId) return null;

  return (
    <div className="trasnaction-type-fileds">
      <Row>
        {/*------------ Transaction type -----------*/}
        <Col xs={5}>
          <FFormGroup
            name={'transaction_type'}
            label={intl.get('transaction_type')}
            labelInfo={<FieldRequiredHint />}
          >
            <FSelect
              name={'transaction_type'}
              items={addMoneyOutOptions}
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
