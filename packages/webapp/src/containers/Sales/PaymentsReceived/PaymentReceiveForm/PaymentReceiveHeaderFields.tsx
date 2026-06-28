// @ts-nocheck
import React, { useMemo } from 'react';
import classNames from 'classnames';
import styled from 'styled-components';
import {
  InputGroup,
  Position,
  Classes,
  ControlGroup,
  Button,
} from '@blueprintjs/core';
import { isEmpty, toSafeInteger } from 'lodash';
import { useFormikContext } from 'formik';
import { css } from '@emotion/css';
import { Theme, useTheme } from '@emotion/react';

import {
  FeatureCan,
  CustomersSelect,
  FormattedMessage as T,
  FMoneyInputGroup,
  Stack,
  FDateInput,
} from '@/components';
import { safeSumBy } from '@/utils';
import {
  FFormGroup,
  AccountsSelect,
  FieldRequiredHint,
  Icon,
  InputPrependText,
  CustomerDrawerLink,
  Hint,
  Money,
} from '@/components';
import { usePaymentReceiveFormContext } from './PaymentReceiveFormProvider';
import { ACCOUNT_TYPE } from '@/constants/accountTypes';
import { ProjectsSelect } from '@/containers/Projects/components';
import {
  PaymentReceiveExchangeRateInputField,
  PaymentReceiveProjectSelectButton,
} from './components';

import {
  amountPaymentEntries,
  fullAmountPaymentEntries,
  customersFieldShouldUpdate,
  accountsFieldShouldUpdate,
} from './utils';
import { Features } from '@/constants';
import { PaymentReceivePaymentNoField } from './PaymentReceivePaymentNoField';
import intl from 'react-intl-universal';

const getHeaderFieldsStyle = (theme: Theme) => css`
  .${theme.bpPrefix}-form-group {
    margin-bottom: 0;

    &.${theme.bpPrefix}-inline {
      max-width: 470px;
    }
    .${theme.bpPrefix}-label {
      min-width: 160px;
    }
    .${theme.bpPrefix}-form-content {
      width: 100%;
    }
  }
`;

/**
 * Payment receive header fields.
 */
export function PaymentReceiveHeaderFields() {
  const theme = useTheme();
  const styleClassName = getHeaderFieldsStyle(theme);

  // Payment receive form context.
  const { accounts, projects } = usePaymentReceiveFormContext();

  // Formik form context.
  const {
    values: { entries, currencyCode },
    setFieldValue,
  } = useFormikContext();

  // Calculates the full-amount received.
  const totalDueAmount = useMemo(
    () => safeSumBy(entries, 'dueAmount'),
    [entries],
  );
  // Handle receive full-amount link click.
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
    <Stack spacing={18} flex={1} className={styleClassName}>
      {/* ------------- Customer name ------------- */}
      <PaymentReceiveCustomerSelect />

      {/* ----------- Exchange rate ----------- */}
      <PaymentReceiveExchangeRateInputField
        name={'exchangeRate'}
        formGroupProps={{ label: ' ', inline: true }}
      />

      {/* ------------- Payment date ------------- */}
      <FFormGroup
        name={'paymentDate'}
        label={intl.get('payment_date')}
        labelInfo={<FieldRequiredHint />}
        inline
        fastField
      >
        <FDateInput
          name={'paymentDate'}
          formatDate={(date) => date.toLocaleDateString()}
          parseDate={(str) => new Date(str)}
          popoverProps={{ position: Position.BOTTOM_LEFT, minimal: true }}
          inputProps={{
            leftIcon: <Icon icon={'date-range'} />,
            fill: true,
          }}
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
            name={'amount'}
            onBlurValue={onFullAmountBlur}
            fastField
          />
        </ControlGroup>

        {!isEmpty(entries) && (
          <Button
            onClick={handleReceiveFullAmountClick}
            className={css`
              &:not([class*='${theme.bpPrefix}-intent-']) {
                &.${theme.bpPrefix}-minimal {
                  width: auto;
                  padding: 0;
                  min-height: auto;
                  font-size: 12px;
                  margin-top: 4px;
                  background-color: transparent;
                  color: #0052cc;

                  &:hover {
                    text-decoration: underline;
                  }
                }
              }
            `}
            small
            minimal
          >
            <T id={'receive_full_amount'} /> (
            <Money amount={totalDueAmount} currency={currencyCode} />)
          </Button>
        )}
      </FFormGroup>

      {/* ------------ Payment receive no. ------------ */}
      <PaymentReceivePaymentNoField />

      {/* ------------ Deposit account ------------ */}
      <FFormGroup
        name={'depositAccountId'}
        label={intl.get('deposit_to')}
        inline={true}
        labelInfo={<FieldRequiredHint />}
        items={accounts}
        shouldUpdate={accountsFieldShouldUpdate}
        fastField={true}
      >
        <AccountsSelect
          name={'depositAccountId'}
          items={accounts}
          labelInfo={<FieldRequiredHint />}
          placeholder={<T id={'select_deposit_account'} />}
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

      {/* ------------ Reference No. ------------ */}
      <FFormGroup
        name={'referenceNo'}
        label={intl.get('reference')}
        inline
        fastField
      >
        <InputGroup name={'referenceNo'} minimal fastField />
      </FFormGroup>

      {/*------------ Project name -----------*/}
      <FeatureCan feature={Features.Projects}>
        <FFormGroup
          name={'projectId'}
          label={intl.get('payment_receive.project_name.label')}
          inline={true}
          className={classNames('form-group--select-list', Classes.FILL)}
        >
          <ProjectsSelect
            name={'projectId'}
            projects={projects}
            input={PaymentReceiveProjectSelectButton}
            popoverFill={true}
          />
        </FFormGroup>
      </FeatureCan>
    </Stack>
  );
}

const CustomerButtonLink = styled(CustomerDrawerLink)`
  font-size: 11px;
  margin-top: 6px;
`;

/**
 * Customer select field of payment receive form.
 * @returns {React.ReactNode}
 */
function PaymentReceiveCustomerSelect() {
  // Payment receive form context.
  const { customers, isNewMode } = usePaymentReceiveFormContext();

  // Formik form context.
  const { values, setFieldValue } = useFormikContext();

  return (
    <FFormGroup
      label={intl.get('customer_name')}
      inline={true}
      labelInfo={<FieldRequiredHint />}
      name={'customerId'}
      fastField={true}
      shouldUpdate={customersFieldShouldUpdate}
      shouldUpdateDeps={{ items: customers }}
    >
      <CustomersSelect
        name={'customerId'}
        items={customers}
        placeholder={<T id={'select_customer_account'} />}
        onItemChange={(customer) => {
          setFieldValue('customerId', customer.id);
          setFieldValue('fullAmount', '');
          setFieldValue('currencyCode', customer?.currency_code);
        }}
        popoverFill={true}
        disabled={!isNewMode}
        allowCreate={true}
        fastField={true}
        shouldUpdate={customersFieldShouldUpdate}
        shouldUpdateDeps={{ items: customers }}
      />
      {values.customerId && (
        <CustomerButtonLink customerId={values.customerId}>
          <T id={'view_customer_details'} />
        </CustomerButtonLink>
      )}
    </FFormGroup>
  );
}
