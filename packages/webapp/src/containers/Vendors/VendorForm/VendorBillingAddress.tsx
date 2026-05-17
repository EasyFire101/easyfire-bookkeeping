// @ts-nocheck
import { Box } from '@/components';
import {
  FormattedMessage as T,
  FFormGroup,
  FInputGroup,
  FTextArea,
} from '@/components';
import { VendorFormSectionTitle } from './VendorFormSectionTitle';

export function VendorBillingAddress() {
  return (
    <Box data-section-id="billingAddress">
      <VendorFormSectionTitle>
        <T id={'billing_address'} />
      </VendorFormSectionTitle>
      <FFormGroup
        name={'billing_address_country'}
        label={<T id={'country'} />}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billing_address_country'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address1'}
        label={<T id={'address_line_1'} />}
        inline
        fill
        fastField
      >
        <FTextArea name={'billing_address1'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address2'}
        label={<T id={'address_line_2'} />}
        inline
        fill
        fastField
      >
        <FTextArea name={'billing_address2'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_city'}
        label={<T id={'city_town'} />}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billing_address_city'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_state'}
        label={<T id={'state'} />}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billing_address_state'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_postcode'}
        label={<T id={'zip_code'} />}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billing_address_postcode'} fill fastField />
      </FFormGroup>

      <FFormGroup
        name={'billing_address_phone'}
        label={<T id={'phone'} />}
        inline
        fill
        fastField
      >
        <FInputGroup name={'billing_address_phone'} fill fastField />
      </FFormGroup>
    </Box>
  );
}
