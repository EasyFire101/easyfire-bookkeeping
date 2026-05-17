import { Divider } from '@blueprintjs/core';
import { css } from '@emotion/css';
import { Box } from '@/components';

import { CustomerFormBasicSection } from './CustomerFormBasicSection';
import { CustomerFormFinancialSection } from './CustomerFormFinancialSection';
import { CustomerBillingAddress } from './CustomerBillingAddress';
import { CustomerShippingAddress } from './CustomerShippingAddress';
import { CustomerFormNotesSection } from './CustomerFormNotesSection';

const customerFormSectionDividerClass = css`
  margin: 20px 0;
`;

export function CustomerFormSections() {
  return (
    <Box>
      <CustomerFormBasicSection />
      <Divider className={customerFormSectionDividerClass} />

      <CustomerFormFinancialSection />
      <Divider className={customerFormSectionDividerClass} />

      <CustomerBillingAddress />
      <Divider className={customerFormSectionDividerClass} />

      <CustomerShippingAddress />
      <Divider className={customerFormSectionDividerClass} />

      <CustomerFormNotesSection />
    </Box>
  );
}