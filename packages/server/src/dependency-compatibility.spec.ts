import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as bcrypt from 'bcrypt';
import { createTransport } from 'nodemailer';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import * as request from 'supertest';
import * as XLSX from 'xlsx';
import {
  extractSheetColumns,
  parseFirstSheet,
  parseSheetToJson,
} from './modules/Import/sheet_utils';

@Controller('dependency-compat')
class DependencyCompatibilityController {
  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('route/:first/:second')
  route(@Param('first') first: string, @Param('second') second: string) {
    return { first, second };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    return {
      name: file.originalname,
      size: file.size,
      value: file.buffer.toString('utf8'),
    };
  }
}

describe('deploy-enabling dependency compatibility', () => {
  let app: NestExpressApplication;
  let publicRoot: string;

  beforeAll(async () => {
    publicRoot = mkdtempSync(join(tmpdir(), 'easyfire-public-compat-'));
    writeFileSync(join(publicRoot, 'proof.txt'), 'easyfire-static-ok', 'utf8');

    const moduleRef = await Test.createTestingModule({
      controllers: [DependencyCompatibilityController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useStaticAssets(publicRoot, { prefix: '/public' });
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (publicRoot) rmSync(publicRoot, { recursive: true, force: true });
  });

  it('round-trips XLSX and CSV data through the production sheet helpers', () => {
    const rows = [
      { Account: 'Cash', Amount: 12.5 },
      { Account: 'Revenue', Amount: -12.5 },
    ];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Journal');

    const xlsxBuffer = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'buffer',
    }) as Buffer;
    const parsedXlsx = parseFirstSheet(Buffer.from(xlsxBuffer));
    expect(extractSheetColumns(parsedXlsx)).toEqual(['Account', 'Amount']);
    expect(parseSheetToJson(parsedXlsx)).toEqual(rows);

    const csvBuffer = Buffer.from(XLSX.utils.sheet_to_csv(worksheet), 'utf8');
    const parsedCsv = parseFirstSheet(csvBuffer);
    expect(extractSheetColumns(parsedCsv)).toEqual(['Account', 'Amount']);
    expect(parseSheetToJson(parsedCsv)).toEqual([
      { Account: 'Cash', Amount: '12.5' },
      { Account: 'Revenue', Amount: '-12.5' },
    ]);
  });

  it('accepts a valid Multer upload and keeps the server healthy', async () => {
    const response = await request(app.getHttpServer())
      .post('/dependency-compat/upload')
      .attach('file', Buffer.from('proof'), 'proof.txt')
      .expect(201);

    expect(response.body).toEqual({
      name: 'proof.txt',
      size: 5,
      value: 'proof',
    });
    await request(app.getHttpServer())
      .get('/dependency-compat/health')
      .expect(200, { ok: true });
  });

  it('rejects oversized and malformed multipart bodies without poisoning health', async () => {
    await request(app.getHttpServer())
      .post('/dependency-compat/upload')
      .attach('file', Buffer.from('123456789'), 'oversized.txt')
      .expect(413);

    const malformed = await request(app.getHttpServer())
      .post('/dependency-compat/upload')
      .set('Content-Type', 'multipart/form-data; boundary=broken')
      .send(
        '--broken\r\nContent-Disposition: form-data; name="file"; filename="broken.txt"\r\nContent-Type: text/plain\r\n\r\nunfinished',
      );
    expect(malformed.status).toBeGreaterThanOrEqual(400);

    await request(app.getHttpServer())
      .get('/dependency-compat/health')
      .expect(200, { ok: true });
  });

  it('serves /public and preserves multi-parameter Express routes', async () => {
    await request(app.getHttpServer())
      .get('/public/proof.txt')
      .expect(200, 'easyfire-static-ok');
    await request(app.getHttpServer())
      .get('/dependency-compat/route/first-value/second-value')
      .expect(200, { first: 'first-value', second: 'second-value' });
  });

  it('constructs a Plaid request through the pinned legacy Axios closure without network', async () => {
    let observedRequest: any;
    const configuration = new Configuration({
      basePath: PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': 'offline-client',
          'PLAID-SECRET': 'offline-secret',
          'Plaid-Version': '2020-09-14',
        },
        adapter: async (config: any) => {
          observedRequest = config;
          return {
            data: { accounts: [], item: {}, request_id: 'offline-proof' },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        },
      },
    });
    const client = new PlaidApi(configuration);

    await client.accountsGet({ access_token: 'offline-access-token' });

    expect(observedRequest.method).toBe('post');
    expect(observedRequest.url).toContain('/accounts/get');
    expect(JSON.parse(observedRequest.data)).toEqual({
      access_token: 'offline-access-token',
    });
    expect(observedRequest.headers['PLAID-CLIENT-ID']).toBe('offline-client');
    expect(observedRequest.headers['PLAID-SECRET']).toBe('offline-secret');
  });

  it('hashes passwords and renders mail through offline transports', async () => {
    const password = 'Synthetic-Dependency-Proof-Only!';
    const hash = await bcrypt.hash(password, 4);
    await expect(bcrypt.compare(password, hash)).resolves.toBe(true);
    await expect(bcrypt.compare('wrong-password', hash)).resolves.toBe(false);

    const transporter = createTransport({ jsonTransport: true });
    const result = await transporter.sendMail({
      from: 'proof@example.invalid',
      to: 'recipient@example.invalid',
      subject: 'Synthetic dependency proof',
      text: 'No message was sent.',
    });
    const message = JSON.parse(result.message.toString());
    expect(message.subject).toBe('Synthetic dependency proof');
    expect(message.text).toBe('No message was sent.');
  });
});
