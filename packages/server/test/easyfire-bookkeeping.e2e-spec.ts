import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { AppModule } from '../src/modules/App/App.module';
import { OrganizationBuildQueue } from '../src/modules/Organization/Organization.types';

const proofId = process.env.EASYFIRE_PROOF_ID ?? '';

if (process.env.EASYFIRE_DISPOSABLE_DB !== 'true') {
  throw new Error(
    'Refusing bookkeeping E2E: EASYFIRE_DISPOSABLE_DB must equal true.',
  );
}
if (!/^[a-f0-9]{32}$/.test(proofId)) {
  throw new Error(
    'Refusing bookkeeping E2E: EASYFIRE_PROOF_ID must be 32 lowercase hex characters.',
  );
}

describe('EasyFire disposable bookkeeping workflow (e2e)', () => {
  let app: INestApplication;
  let authorization: string;
  let organizationId: string;
  let debitAccountId: number;
  let creditAccountId: number;
  let journalId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const email = `easyfire-proof-${proofId}@example.invalid`;
    const password = `Proof-${proofId}-Only!`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        firstName: 'EasyFire',
        lastName: 'DisposableProof',
        email,
        password,
      })
      .expect(201);
    let signin = await request(app.getHttpServer())
      .post('/auth/signin')
      .send({ email, password })
      .expect(201);

    organizationId = signup.body.organization_id;
    authorization = `Bearer ${signin.body.access_token}`;

    const build = await request(app.getHttpServer())
      .post('/organization/build')
      .set('Authorization', authorization)
      .set('organization-id', organizationId)
      .send({
        name: `EasyFire Disposable Proof ${proofId}`,
        baseCurrency: 'USD',
        location: 'US',
        language: 'en',
        fiscalYear: 'january',
        timezone: 'UTC',
      })
      .expect(200);

    const buildJobId = build.body?.data?.job_id ?? build.body?.data?.jobId;
    if (!buildJobId) {
      throw new Error('Organization build did not return a job ID.');
    }

    let buildCompleted = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const status = await request(app.getHttpServer())
        .get(`/organization/build/${buildJobId}`)
        .set('Authorization', authorization)
        .set('organization-id', organizationId)
        .expect(200);
      const isCompleted =
        status.body?.is_completed ?? status.body?.isCompleted ?? false;
      const isFailed = status.body?.is_failed ?? status.body?.isFailed ?? false;

      if (isFailed) {
        const queue = app.get<Queue>(getQueueToken(OrganizationBuildQueue));
        const job = await queue.getJob(buildJobId);
        const failedReason = (job?.failedReason || 'unknown reason')
          .replace(/\s+/g, ' ')
          .slice(0, 400);
        throw new Error(
          `Organization build job reported failure: ${failedReason}`,
        );
      }
      if (isCompleted) {
        buildCompleted = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (!buildCompleted) {
      throw new Error(
        'Organization build did not complete within 120 seconds.',
      );
    }

    signin = await request(app.getHttpServer())
      .post('/auth/signin')
      .send({ email, password })
      .expect(201);
    organizationId = signin.body.organization_id;
    authorization = `Bearer ${signin.body.access_token}`;

    const debitAccount = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', authorization)
      .set('organization-id', organizationId)
      .send({
        name: `Proof Cash ${proofId}`,
        accountType: 'cash',
        code: `D${proofId.slice(0, 5).toUpperCase()}`,
      })
      .expect(201);
    const creditAccount = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', authorization)
      .set('organization-id', organizationId)
      .send({
        name: `Proof Income ${proofId}`,
        accountType: 'other-income',
        code: `C${proofId.slice(0, 5).toUpperCase()}`,
      })
      .expect(201);

    debitAccountId = debitAccount.body.id;
    creditAccountId = creditAccount.body.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('creates, reads, and removes one uniquely labeled balanced journal', async () => {
    const reference = `EASYFIRE-PROOF-${proofId}`;
    const created = await request(app.getHttpServer())
      .post('/manual-journals')
      .set('Authorization', authorization)
      .set('organization-id', organizationId)
      .send({
        date: '2026-01-01',
        reference,
        journalNumber: `PROOF-${proofId.slice(0, 12)}`,
        publish: false,
        entries: [
          { index: 1, debit: 1, credit: 0, accountId: debitAccountId },
          { index: 2, debit: 0, credit: 1, accountId: creditAccountId },
        ],
      })
      .expect(201);

    journalId = created.body.id;
    const readBack = await request(app.getHttpServer())
      .get(`/manual-journals/${journalId}`)
      .set('Authorization', authorization)
      .set('organization-id', organizationId)
      .expect(200);

    expect(readBack.body.reference).toBe(reference);

    await request(app.getHttpServer())
      .delete(`/manual-journals/${journalId}`)
      .set('Authorization', authorization)
      .set('organization-id', organizationId)
      .expect(200);
  }, 120_000);
});
