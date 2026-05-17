// @ts-nocheck
import { Box, FFormGroup, FormattedMessage as T, FTextArea } from '@/components';
import { VendorFormSectionTitle } from './VendorFormSectionTitle';

export function VendorFormNotesSection() {
  return (
    <Box data-section-id="notes">
      <VendorFormSectionTitle>
        <T id={'notes'} />
      </VendorFormSectionTitle>

      <FFormGroup name={'note'} label={<T id={'note'} />} inline fill fastField>
        <FTextArea name={'note'} fill fastField />
      </FFormGroup>
    </Box>
  );
}
