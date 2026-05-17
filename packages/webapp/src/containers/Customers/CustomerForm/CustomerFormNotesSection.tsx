import { Box, FFormGroup, FormattedMessage as T, FTextArea } from '@/components';
import { CustomerFormSectionTitle } from './CustomerFormSectionTitle';

export function CustomerFormNotesSection() {
  return (
    <Box data-section-id="notes">
      <CustomerFormSectionTitle>
        <T id={'notes'} />
      </CustomerFormSectionTitle>

      <FFormGroup name={'note'} label={<T id={'note'} />} inline>
        <FTextArea name={'note'} fill />
      </FFormGroup>
    </Box>
  );
}
