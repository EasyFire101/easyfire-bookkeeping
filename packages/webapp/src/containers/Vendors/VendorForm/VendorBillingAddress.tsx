// @ts-nocheck
import intl from 'react-intl-universal';
import { VendorFormSectionTitle } from './VendorFormSectionTitle';
import { Box } from '@/components';
import {
  FormattedMessage as T,
  FFormGroup,
  FInputGroup,
  FTextArea,
} from '@/components';

export function VendorBillingAddress() {
  return (
    <Box data-section-id="billingAddress">
      <VendorFormSectionTitle>
        <T id={'billing_address'} />
      </VendorFormSectionTitle>
      <FFormGroup
        name={'billing_address_country'}
        label={intl.get('country')}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billing_address_country'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address1'}
        label={intl.get('address_line_1')}
        inline
        fill
        fastField
      >
        <FTextArea name={'billing_address1'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address2'}
        label={intl.get('address_line_2')}
        inline
        fill
        fastField
      >
        <FTextArea name={'billing_address2'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_city'}
        label={intl.get('city_town')}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billing_address_city'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_state'}
        label={intl.get('state')}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billing_address_state'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_postcode'}
        label={intl.get('zip_code')}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billing_address_postcode'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_phone'}
        label={intl.get('phone')}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billing_address_phone'} fill fastField />
      </FFormGroup>
    </Box>
  );
}
