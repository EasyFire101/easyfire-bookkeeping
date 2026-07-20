import 'reflect-metadata';

import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { validate } from 'class-validator';

import {
  ACCEPTED_LOCALES,
  DATE_FORMATS,
  MONTHS,
} from '../Organization.constants';
import {
  ACCEPTED_LOCALES as LEGACY_ACCEPTED_LOCALES,
  DATE_FORMATS as LEGACY_DATE_FORMATS,
  MONTHS as LEGACY_MONTHS,
} from '../Organization/constants';
import { OrganizationMetadataResponseDto } from './GetCurrentOrganizationResponse.dto';
import {
  BuildOrganizationDto,
  UpdateOrganizationDto,
} from './Organization.dto';

type DtoClass = { prototype: object };

const getDocumentedExample = (dto: DtoClass, property: string): unknown =>
  Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, dto.prototype, property)
    ?.example;

describe('Organization DTO documentation contract', () => {
  it('documents a build payload accepted by its validators', async () => {
    const payload = Object.assign(new BuildOrganizationDto(), {
      name: getDocumentedExample(BuildOrganizationDto, 'name'),
      location: getDocumentedExample(BuildOrganizationDto, 'location'),
      baseCurrency: getDocumentedExample(BuildOrganizationDto, 'baseCurrency'),
      timezone: getDocumentedExample(BuildOrganizationDto, 'timezone'),
      fiscalYear: getDocumentedExample(BuildOrganizationDto, 'fiscalYear'),
      language: getDocumentedExample(BuildOrganizationDto, 'language'),
      dateFormat: getDocumentedExample(BuildOrganizationDto, 'dateFormat'),
    });

    expect(await validate(payload)).toEqual([]);
    expect({
      fiscalYear: payload.fiscalYear,
      language: payload.language,
      dateFormat: payload.dateFormat,
    }).toEqual({
      fiscalYear: 'january',
      language: 'en',
      dateFormat: 'MM/DD/yyyy',
    });
  });

  it('uses the same canonical examples for build, update, and response DTOs', () => {
    const expectedExamples = {
      fiscalYear: 'january',
      language: 'en',
      dateFormat: 'MM/DD/yyyy',
    };

    for (const dto of [
      BuildOrganizationDto,
      UpdateOrganizationDto,
      OrganizationMetadataResponseDto,
    ]) {
      expect({
        fiscalYear: getDocumentedExample(dto, 'fiscalYear'),
        language: getDocumentedExample(dto, 'language'),
        dateFormat: getDocumentedExample(dto, 'dateFormat'),
      }).toEqual(expectedExamples);
    }
  });

  it('keeps the compatibility constants path bound to the canonical contract', () => {
    expect(LEGACY_MONTHS).toBe(MONTHS);
    expect(LEGACY_ACCEPTED_LOCALES).toBe(ACCEPTED_LOCALES);
    expect(LEGACY_DATE_FORMATS).toBe(DATE_FORMATS);
  });
});
