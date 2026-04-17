// @ts-nocheck
import { Divider } from '@blueprintjs/core';
import { css } from '@emotion/css';
import { Box } from '@/components';

import { ItemFormBasicSection } from './ItemFormBasicSection';
import { ItemFormSellingSection } from './ItemFormSellingSection';
import { ItemFormPurchasingSection } from './ItemFormPurchasingSection';
import { ItemFormInventorySection } from './ItemFormInventorySection';

const itemFormSectionDividerClass = css`
  margin: 20px 0;
`;

export function ItemFormSections() {
  return (
    <Box>
      <ItemFormBasicSection />
      <Divider className={itemFormSectionDividerClass} />

      <ItemFormSellingSection />
      <Divider className={itemFormSectionDividerClass} />

      <ItemFormPurchasingSection />
      <Divider className={itemFormSectionDividerClass} />

      <ItemFormInventorySection />
    </Box>
  );
}
