// @ts-nocheck
import React from 'react';
import intl from 'react-intl-universal';
import { CustomerFormSectionTitle } from './CustomerFormSectionTitle';
import { Box } from '@/components';
import {
  FormattedMessage as T,
  FFormGroup,
  FInputGroup,
  FTextArea,
} from '@/components';

export function CustomerShippingAddress() {
  return (
    <Box data-section-id="shippingAddress">
      <CustomerFormSectionTitle>
        <T id={'shipping_address'} />
      </CustomerFormSectionTitle>
      <FFormGroup
        name={'shipping_address_country'}
        label={intl.get('country')}
        inline
        fill
      >
        <FInputGroup name={'shipping_address_country'} fill />
      </FFormGroup>

      <FFormGroup
        name={'shipping_address1'}
        label={intl.get('address_line_1')}
        inline
        fill
      >
        <FTextArea name={'shipping_address1'} fill />
      </FFormGroup>

      <FFormGroup
        name={'shipping_address2'}
        label={intl.get('address_line_2')}
        inline
        fill
      >
        <FTextArea name={'shipping_address2'} fill />
      </FFormGroup>

      <FFormGroup
        name={'shipping_address_city'}
        label={intl.get('city_town')}
        inline
        fill
      >
        <FInputGroup name={'shipping_address_city'} fill />
      </FFormGroup>

      <FFormGroup
        name={'shipping_address_state'}
        label={intl.get('state')}
        inline
        fill
      >
        <FInputGroup name={'shipping_address_state'} fill />
      </FFormGroup>

      <FFormGroup
        name={'shipping_address_postcode'}
        label={intl.get('zip_code')}
        inline
        fill
      >
        <FInputGroup name={'shipping_address_postcode'} fill />
      </FFormGroup>

      <FFormGroup
        name={'shipping_address_phone'}
        label={intl.get('phone')}
        inline
        fill
      >
        <FInputGroup name={'shipping_address_phone'} fill />
      </FFormGroup>
    </Box>
  );
}
