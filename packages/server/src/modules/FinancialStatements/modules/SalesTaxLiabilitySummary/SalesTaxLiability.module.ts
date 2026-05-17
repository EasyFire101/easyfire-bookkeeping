import { Module } from '@nestjs/common';
import { SalesTaxLiabiltiySummaryPdf } from './SalesTaxLiabiltiySummaryPdf';
import { SalesTaxLiabilitySummaryTableInjectable } from './SalesTaxLiabilitySummaryTableInjectable';
import { SalesTaxLiabilitySummaryExportInjectable } from './SalesTaxLiabilitySummaryExportInjectable';
import { SalesTaxLiabilitySummaryService } from './SalesTaxLiabilitySummaryService';
import { SalesTaxLiabilitySummaryApplication } from './SalesTaxLiabilitySummaryApplication';
import { SalesTaxLiabilitySummaryController } from './SalesTaxLiabilitySummary.controller';
import { FinancialSheetCommonModule } from '../../common/FinancialSheetCommon.module';
import { SalesTaxLiabilitySummaryRepository } from './SalesTaxLiabilitySummaryRepository';
import { SalesTaxLiabilitySummaryMeta } from './SalesTaxLiabilitySummaryMeta';
import { TenancyModule } from '@/modules/Tenancy/Tenancy.module';

@Module({
  imports: [FinancialSheetCommonModule, TenancyModule],
  providers: [
    SalesTaxLiabiltiySummaryPdf,
    SalesTaxLiabilitySummaryTableInjectable,
    SalesTaxLiabilitySummaryExportInjectable,
    SalesTaxLiabilitySummaryService,
    SalesTaxLiabilitySummaryRepository,
    SalesTaxLiabilitySummaryMeta,
    SalesTaxLiabilitySummaryApplication,
  ],
  controllers: [SalesTaxLiabilitySummaryController],
})
export class SalesTaxLiabilityModule {}
