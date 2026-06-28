// @ts-nocheck
import React, { useMemo } from 'react';
import styled from 'styled-components';
import classNames from 'classnames';
import { isEmpty, toSafeInteger } from 'lodash';
import {
  FormGroup,
  InputGroup,
  Position,
  Classes,
  ControlGroup,
  Button,
} from '@blueprintjs/core';
import { DateInput } from '@blueprintjs/datetime';
import { FastField, useFormikContext, ErrorMessage } from 'formik';
import { css } from '@emotion/css';
import { Theme, useTheme } from '@emotion/react';

import {
  FDateInput,
  FInputGroup,
  FMoneyInputGroup,
  Stack,
  FormattedMessage as T,
  VendorsSelect,
} from '@/components';
import { CLASSES } from '@/constants/classes';

import {
  FFormGroup,
  AccountsSelect,
  FieldRequiredHint,
  InputPrependText,
  Money,
  Hint,
  Icon,
  VendorDrawerLink,
} from '@/components';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import { usePaymentMadeFormContext } from './PaymentMadeFormProvider';
import { ACCOUNT_TYPE } from '@/constants/accountTypes';
import { PaymentMadeExchangeRateInputField } from './components';
import {
  momentFormatter,
  tansformDateValue,
  handleDateChange,
  inputIntent,
  compose,
  safeSumBy,
  fullAmountPaymentEntries,
  amountPaymentEntries,
} from '@/utils';
import { accountsFieldShouldUpdate, vendorsFieldShouldUpdate } from './utils';
import intl from 'react-intl-universal';

const getFieldsStyle = (theme: Theme) => css`
  .${theme.bpPrefix}-form-group {
    margin-bottom: 0;

    &.${theme.bpPrefix}-inline {
      max-width: 450px;
    }
    .${theme.bpPrefix}-label {
      min-width: 150px;
      font-weight: 500;
    }
    .${theme.bpPrefix}-form-content {
      width: 100%;
    }
  }
`;

/**
 * Payment made form header fields.
 */
function PaymentMadeFormHeaderFieldsInner() {
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  // Formik form context.
  const {
    values: { entries, currencyCode },
    setFieldValue,
  } = useFormikContext();

  const theme = useTheme();
  const fieldsClassName = getFieldsStyle(theme);

  // Payment made form context.
  const { accounts } = usePaymentMadeFormContext();

  // Sumation of payable full-amount.
  const payableFullAmount = useMemo(
    () => safeSumBy(entries, 'dueAmount'),
    [entries],
  );

  // Handle receive full-amount click.
  const handleReceiveFullAmountClick = () => {
    const newEntries = fullAmountPaymentEntries(entries);
    const fullAmount = safeSumBy(newEntries, 'paymentAmount');

    setFieldValue('entries', newEntries);
    setFieldValue('amount', fullAmount);
  };

  // Handles the full-amount field blur.
  const onFullAmountBlur = (value) => {
    const newEntries = amountPaymentEntries(toSafeInteger(value), entries);
    setFieldValue('entries', newEntries);
  };

  return (
    <Stack spacing={18} flex={1} className={fieldsClassName}>
      {/* ------------ Vendor name ------------ */}
      <PaymentFormVendorSelect />

      {/* ----------- Exchange rate ----------- */}
      <PaymentMadeExchangeRateInputField
        name={'exchangeRate'}
        formGroupProps={{ label: ' ', inline: true }}
      />

      {/* ------------ Payment date ------------ */}
      <FFormGroup
        name={'paymentDate'}
        label={intl.get('payment_date')}
        labelInfo={<FieldRequiredHint />}
        inline
        fill
        fastField
      >
        <FDateInput
          name={'paymentDate'}
          {...momentFormatter('YYYY/MM/DD')}
          popoverProps={{ position: Position.BOTTOM, minimal: true }}
          inputProps={{ leftIcon: <Icon icon={'date-range'} /> }}
          fill
          fastField
        />
      </FFormGroup>

      {/* ------------ Full amount ------------ */}
      <FFormGroup
        name={'amount'}
        label={intl.get('full_amount')}
        inline={true}
        labelInfo={<Hint />}
        fastField
      >
        <ControlGroup>
          <InputPrependText text={currencyCode} />
          <FMoneyInputGroup
            fastField
            name={'amount'}
            onBlurValue={onFullAmountBlur}
          />
        </ControlGroup>

        {!isEmpty(entries) && (
          <Button
            onClick={handleReceiveFullAmountClick}
            className={'receive-full-amount'}
            small={true}
            minimal={true}
          >
            <T id={'receive_full_amount'} /> (
            <Money amount={payableFullAmount} currency={currencyCode} />)
          </Button>
        )}
      </FFormGroup>

      {/* ------------ Payment number ------------ */}
      <FFormGroup
        name={'paymentNumber'}
        label={intl.get('payment_no')}
        inline={true}
        fastField
      >
        <FInputGroup name={'paymentNumber'} minimal={true} fastField />
      </FFormGroup>

      {/* ------------ Payment account ------------ */}
      <FFormGroup
        name={'paymentAccountId'}
        label={intl.get('payment_account')}
        labelInfo={<FieldRequiredHint />}
        items={accounts}
        shouldUpdate={accountsFieldShouldUpdate}
        inline={true}
        fastField={true}
      >
        <AccountsSelect
          name={'paymentAccountId'}
          items={accounts}
          placeholder={<T id={'select_payment_account'} />}
          labelInfo={<FieldRequiredHint />}
          filterByTypes={[
            ACCOUNT_TYPE.CASH,
            ACCOUNT_TYPE.BANK,
            ACCOUNT_TYPE.OTHER_CURRENT_ASSET,
          ]}
          shouldUpdate={accountsFieldShouldUpdate}
          fastField={true}
          fill={true}
        />
      </FFormGroup>

      {/* ------------ Reference ------------ */}
      <FFormGroup
        name={'reference'}
        label={intl.get('reference')}
        inline={true}
        fastField
      >
        <FInputGroup name={'reference'} minimal={true} fastField />
      </FFormGroup>
    </Stack>
  );
}

/**
 * Vendor select field of payment receive form.
 * @returns {React.ReactNode}
 */
function PaymentFormVendorSelect() {
  // Formik form context.
  const { values, setFieldValue } = useFormikContext();

  // Payment made form context.
  const { vendors, isNewMode, setPaymentVendorId } =
    usePaymentMadeFormContext();

  return (
    <FFormGroup
      name={'vendorId'}
      label={intl.get('vendor_name')}
      labelInfo={<FieldRequiredHint />}
      inline={true}
      fastField={true}
      shouldUpdate={vendorsFieldShouldUpdate}
      shouldUpdateDeps={{ items: vendors }}
    >
      <VendorsSelect
        name={'vendorId'}
        items={vendors}
        placeholder={<T id={'select_vender_account'} />}
        onItemChange={(contact) => {
          setFieldValue('vendorId', contact.id);
          setFieldValue('currencyCode', contact?.currency_code);
          setPaymentVendorId(contact.id);
        }}
        disabled={!isNewMode}
        allowCreate={true}
        fastField={true}
        shouldUpdate={vendorsFieldShouldUpdate}
        shouldUpdateDeps={{ items: vendors }}
      />
      {values.vendorId && (
        <VendorButtonLink vendorId={values.vendorId}>
          <T id={'view_vendor_details'} />
        </VendorButtonLink>
      )}
    </FFormGroup>
  );
}

export const PaymentMadeFormHeaderFields = PaymentMadeFormHeaderFieldsInner;

const VendorButtonLink = styled(VendorDrawerLink)`
  font-size: 11px;
  margin-top: 6px;
`;
