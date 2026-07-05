// @ts-nocheck
import {
  Classes,
  FormGroup,
  InputGroup,
  TextArea,
  Position,
  ControlGroup,
} from '@blueprintjs/core';
import { DateInput } from '@blueprintjs/datetime';
import classNames from 'classnames';
import { FastField, ErrorMessage, useFormikContext } from 'formik';
import { isEqual } from 'lodash';
import React from 'react';
import intl from 'react-intl-universal';
import styled from 'styled-components';
import { useRefundCreditNoteContext } from './RefundCreditNoteFormProvider';
import { useSetPrimaryBranchToForm } from './utils';
import {
  Icon,
  Col,
  Row,
  If,
  FieldRequiredHint,
  FAccountsSuggestField,
  InputPrependText,
  MoneyInputGroup,
  ExchangeRateMutedField,
  BranchSelect,
  FeatureCan,
  FInputGroup,
  FMoneyInputGroup,
  FDateInput,
  FFormGroup,
  FTextArea,
} from '@/components';
import { CLASSES, Features } from '@/constants';
import { ACCOUNT_TYPE } from '@/constants/accountTypes';
import { useAutofocus } from '@/hooks';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import {
  inputIntent,
  momentFormatter,
  tansformDateValue,
  handleDateChange,
} from '@/utils';

/**
 * Refund credit note form fields.
 */
function RefundCreditNoteFormFieldsInner() {
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  const { accounts, branches } = useRefundCreditNoteContext();
  const { values } = useFormikContext();

  const amountFieldRef = useAutofocus();

  // Sets the primary branch to form.
  useSetPrimaryBranchToForm();

  return (
    <div className={Classes.DIALOG_BODY}>
      <FeatureCan feature={Features.Branches}>
        <Row>
          <Col xs={5}>
            <FFormGroup name={'branch_id'} label={intl.get('branch')}>
              <BranchSelect
                name={'branch_id'}
                branches={branches}
                popoverProps={{ minimal: true }}
              />
            </FFormGroup>
          </Col>
        </Row>
        <BranchRowDivider />
      </FeatureCan>

      <Row>
        <Col xs={5}>
          {/* ------------- Refund date ------------- */}
          <FFormGroup
            name={'date'}
            label={intl.get('refund_credit_note.dialog.refund_date')}
            labelInfo={<FieldRequiredHint />}
            fill
          >
            <FDateInput
              name={'date'}
              {...momentFormatter('YYYY/MM/DD')}
              popoverProps={{ position: Position.BOTTOM, minimal: true }}
              inputProps={{
                leftIcon: <Icon icon={'date-range'} />,
              }}
            />
          </FFormGroup>
        </Col>

        <Col xs={5}>
          {/* ------------ Form account ------------ */}
          <FFormGroup
            name={'from_account_id'}
            label={intl.get('refund_credit_note.dialog.from_account')}
            labelInfo={<FieldRequiredHint />}
            fill
            fastField
          >
            <FAccountsSuggestField
              name={'from_account_id'}
              items={accounts}
              inputProps={{
                placeholder: intl.get('select_account'),
              }}
              filterByTypes={[
                ACCOUNT_TYPE.BANK,
                ACCOUNT_TYPE.CASH,
                ACCOUNT_TYPE.FIXED_ASSET,
              ]}
              fastField
            />
          </FFormGroup>
        </Col>
      </Row>

      {/* ------------- Amount ------------- */}
      <FFormGroup
        name={'amount'}
        label={intl.get('refund_credit_note.dialog.amount')}
        labelInfo={<FieldRequiredHint />}
        fill
        fastField
      >
        <ControlGroup>
          <InputPrependText text={values.currency_code} />
          <FMoneyInputGroup
            name={'amount'}
            minimal={true}
            inputRef={(ref) => (amountFieldRef.current = ref)}
          />
        </ControlGroup>
      </FFormGroup>

      {/*------------ exchange rate -----------*/}
      <If condition={!isEqual(baseCurrency, values.currency_code)}>
        <ExchangeRateMutedField
          name={'exchange_rate'}
          fromCurrency={baseCurrency}
          toCurrency={values.currency_code}
          formGroupProps={{ label: '', inline: false }}
          date={values.date}
          exchangeRate={values.exchange_rate}
        />
      </If>

      {/* ------------ Reference No. ------------ */}
      <FFormGroup
        name={'reference_no'}
        label={intl.get('reference_no')}
        fill
        fastField
      >
        <FInputGroup name={'reference_no'} minimal fill />
      </FFormGroup>

      {/* --------- Statement --------- */}
      <FFormGroup
        name={'description'}
        label={intl.get('refund_credit_note.dialog.description')}
        fill
        fastField
      >
        <FTextArea name={'description'} growVertically fill fastField />
      </FFormGroup>
    </div>
  );
}

export const RefundCreditNoteFormFields = RefundCreditNoteFormFieldsInner;

export const BranchRowDivider = styled.div`
  --x-divider-color: #ebf1f6;

  .bp4-dark & {
    --x-divider-color: rgba(255, 255, 255, 0.1);
  }
  height: 1px;
  background: var(--x-divider-color);
  margin-bottom: 13px;
`;
