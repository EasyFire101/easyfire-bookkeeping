import { Module } from '@nestjs/common';
import { ExchangeRatesController } from './ExchangeRates.controller';
import { ExchangeRatesService } from './ExchangeRates.service';
import { ExchangeRateApplication } from './ExchangeRates.application';

@Module({
  providers: [ExchangeRatesService, ExchangeRateApplication],
  controllers: [ExchangeRatesController],
  exports: [ExchangeRatesService, ExchangeRateApplication],
})
export class ExchangeRatesModule {}
