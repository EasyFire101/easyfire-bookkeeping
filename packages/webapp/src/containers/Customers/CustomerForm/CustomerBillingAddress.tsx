// @ts-nocheck
import React from 'react';
import { Box } from '@/components';
import {
  FormattedMessage as T,
  FFormGroup,
  FInputGroup,
  FTextArea,
} from '@/components';
import { CustomerFormSectionTitle } from './CustomerFormSectionTitle';

export function CustomerBillingAddress() {
  return (
    <Box data-section-id="billingAddress">
      <CustomerFormSectionTitle>
        <T id={'billing_address'} />
      </CustomerFormSectionTitle>
      <FFormGroup
        name={'billing_address_country'}
        label={<T id={'country'} />}
        inline
        fill
      >
        <FInputGroup name={'billing_address_country'} fill />
      </FFormGroup>

      <FFormGroup
        name={'billing_address1'}
        label={<T id={'address_line_1'} />}
        inline
        fill
      >
        <FTextArea name={'billing_address1'} fill />
      </FFormGroup>

      <FFormGroup
        name={'billing_address2'}
        label={<T id={'address_line_2'} />}
        inline
        fill
      >
        <FTextArea name={'billing_address2'} fill />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_city'}
        label={<T id={'city_town'} />}
        inline
        fill
      >
        <FInputGroup name={'billing_address_city'} fill />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_state'}
        label={<T id={'state'} />}
        inline
        fill
      >
        <FInputGroup name={'billing_address_state'} fill />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_postcode'}
        label={<T id={'zip_code'} />}
        inline
        fill
      >
        <FInputGroup name={'billing_address_postcode'} fill />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_phone'}
        label={<T id={'phone'} />}
        inline
        fill
      >
        <FInputGroup name={'billing_address_phone'} fill />
      </FFormGroup>
    </Box>
  );
}
