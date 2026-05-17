// @ts-nocheck
import intl from 'react-intl-universal';
import { ControlGroup, Divider, Icon as BlueprintIcon } from '@blueprintjs/core';
import {
  Hint,
  FieldRequiredHint,
  SalutationList,
  DisplayNameList,
  FormattedMessage as T,
  FInputGroup,
  FFormGroup,
  Box,
  Icon,
  Stack,
} from '@/components';
import { VendorFormSectionTitle } from './VendorFormSectionTitle';
import { useAutofocus } from '@/hooks';

export function VendorFormBasicSection({}) {
  const firstNameFieldRef = useAutofocus();

  return (
    <Box data-section-id="primary">
      <VendorFormSectionTitle>Vendor details</VendorFormSectionTitle>

      {/**----------- Contact name -----------*/}
      <FFormGroup
        name={'salutation'}
        label={<T id={'contact_name'} />}
        inline
        fill
        fastField
      >
        <ControlGroup fill>
          <SalutationList
            name={'salutation'}
            popoverProps={{ minimal: true }}
            fastField
          />
          <FInputGroup
            name={'first_name'}
            placeholder={intl.get('first_name')}
            inputRef={(ref) => (firstNameFieldRef.current = ref)}
            fill
            fastField
          />
          <FInputGroup
            name={'last_name'}
            placeholder={intl.get('last_name')}
            fill
            fastField
          />
        </ControlGroup>
      </FFormGroup>

      <FFormGroup
        name={'code'}
        label={'Vendor Code'}
        helperText="Add a unique account number to identify, reference and search for the contact."
        inline
        fill
        fastField
      >
        <FInputGroup name={'code'} fill fastField />
      </FFormGroup>

      {/*----------- Company Name -----------*/}
      <FFormGroup
        name={'company_name'}
        label={<T id={'company_name'} />}
        inline
        fill
        fastField
      >
        <FInputGroup name={'company_name'} fill fastField />
      </FFormGroup>

      {/*----------- Display Name -----------*/}
      <FFormGroup
        name={'display_name'}
        label={<T id={'display_name'} />}
        helperText="This is the name that appears on invoices and emails."
        inline
        fill
        fastField
      >
        <DisplayNameList
          name={'display_name'}
          popoverProps={{ minimal: true }}
          buttonProps={{ fill: true }}
          fastField
        />
      </FFormGroup>

      <Divider style={{ margin: '20px 0' }} />

      {/*------------ Vendor email -----------*/}
      <FFormGroup
        name={'email'}
        label={<T id={'vendor_email'} />}
        inline
        fastField
      >
        <FInputGroup
          name={'email'}
          leftIcon={<Icon icon="envelope" />}
          fastField
        />
      </FFormGroup>

      {/*------------ Phone number -----------*/}
      <FFormGroup
        name={'work_phone'}
        className={'form-group--phone-number'}
        label={<T id={'phone_number'} />}
        inline
        fastField
      >
        <Stack spacing={10}>
          <FInputGroup name={'work_phone'} placeholder={intl.get('work')} leftIcon="phone" fastField
          />
          <FInputGroup
            name={'personal_phone'}
            placeholder={intl.get('mobile')}
            fastField
          />
        </Stack>
      </FFormGroup>

      {/*------------ Vendor website -----------*/}
      <FFormGroup name={'website'} label={<T id={'website'} />} inline fastField>
        <FInputGroup
          name={'website'}
          placeholder={'http://'}
          leftIcon={<BlueprintIcon icon="globe-network" />}
          fastField
        />
      </FFormGroup>
    </Box>
  );
}
