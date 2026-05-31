// @ts-nocheck
import React from 'react';
import { AccountsReceivableSection } from './AccountsReceivableSection';
import { AccountsPayableSection } from './AccountsPayableSection';
import { FinancialAccountingSection } from './FinancialAccountingSection';
import { ProductsServicesSection } from './ProductsServicesSection';
import '@/style/pages/HomePage/HomePage.scss';

export function HomepageContent() {
  return (
    <div className="financial-reports">
      <AccountsReceivableSection />
      <AccountsPayableSection />
      <FinancialAccountingSection />
      <ProductsServicesSection />
    </div>
  );
}
