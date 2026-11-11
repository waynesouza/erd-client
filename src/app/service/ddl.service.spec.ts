import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { DdlService, ExportDdlResponse } from './ddl.service';
import {
  installFakeFileReader,
  lastFileReader,
  restoreFileReader
} from '../../testing/file-reader.double';

const BASE_URL = 'http://localhost:8080/api/ddl';

describe('DdlService', () => {
  let service: DdlService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(DdlService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('exportDdl', () => {
    it('should GET the DDL of a project', () => {
      const response: ExportDdlResponse = { ddlContent: 'CREATE TABLE t();', projectId: 'project-1' };
      let received: ExportDdlResponse | undefined;

      service.exportDdl('project-1').subscribe(r => (received = r));

      const req = httpMock.expectOne(`${BASE_URL}/export/project-1`);
      expect(req.request.method).toBe('GET');
      req.flush(response);

      expect(received).toEqual(response);
    });

    it('should surface the error arm', () => {
      let status: number | undefined;

      service.exportDdl('project-1').subscribe({ error: err => (status = err.status) });

      httpMock.expectOne(`${BASE_URL}/export/project-1`)
        .flush(null, { status: 500, statusText: 'Server Error' });

      expect(status).toBe(500);
    });
  });

  describe('importDdl', () => {
    it('should POST the DDL payload', () => {
      let completed = false;

      service.importDdl({ projectId: 'project-1', ddlContent: 'CREATE TABLE t();' })
        .subscribe(() => (completed = true));

      const req = httpMock.expectOne(`${BASE_URL}/import`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ projectId: 'project-1', ddlContent: 'CREATE TABLE t();' });
      req.flush(null);

      expect(completed).toBeTrue();
    });

    it('should emit what the server reports about the import', () => {
      let result: unknown;

      service.importDdl({ projectId: 'project-1', ddlContent: 'CREATE TABLE t(id INT);' })
        .subscribe(response => (result = response));

      httpMock.expectOne(`${BASE_URL}/import`)
        .flush({ tables: 1, relationships: 0, warnings: ['Table t has no primary key.'] });

      expect(result).toEqual({ tables: 1, relationships: 0, warnings: ['Table t has no primary key.'] });
    });

    it('should surface the error arm', () => {
      let status: number | undefined;

      service.importDdl({ projectId: 'project-1', ddlContent: 'bad sql' })
        .subscribe({ error: err => (status = err.status) });

      httpMock.expectOne(`${BASE_URL}/import`)
        .flush(null, { status: 400, statusText: 'Bad Request' });

      expect(status).toBe(400);
    });
  });

  describe('downloadSqlFile', () => {
    // The anchor prototype is spied rather than document.createElement, which
    // would intercept every element Angular creates for the rest of the spec.
    let captured: { download: string; href: string } | null;
    let createObjectUrl: jasmine.Spy;
    let revokeObjectUrl: jasmine.Spy;

    beforeEach(() => {
      captured = null;
      spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
        captured = { download: this.download, href: this.href };
      });
      createObjectUrl = spyOn(window.URL, 'createObjectURL').and.returnValue('blob:fake-url');
      revokeObjectUrl = spyOn(window.URL, 'revokeObjectURL');
    });

    it('should download using the default filename', () => {
      service.downloadSqlFile('CREATE TABLE t();');

      expect(captured!.download).toBe('diagram.sql');
      expect(captured!.href).toBe('blob:fake-url');
    });

    it('should download using an explicit filename', () => {
      // Covers the other half of the `filename = 'diagram.sql'` default-arg branch.
      service.downloadSqlFile('CREATE TABLE t();', 'sales.sql');

      expect(captured!.download).toBe('sales.sql');
    });

    it('should build a blob of type application/sql', () => {
      service.downloadSqlFile('CREATE TABLE t();');

      const blob = createObjectUrl.calls.mostRecent().args[0] as Blob;
      expect(blob.type).toBe('application/sql');
      expect(blob.size).toBe('CREATE TABLE t();'.length);
    });

    it('should revoke the object URL and detach the anchor', () => {
      service.downloadSqlFile('CREATE TABLE t();');

      expect(revokeObjectUrl).toHaveBeenCalledOnceWith('blob:fake-url');
      expect(document.querySelector('a[download="diagram.sql"]')).toBeNull();
    });
  });

  describe('readSqlFile', () => {
    beforeEach(() => installFakeFileReader());
    afterEach(() => restoreFileReader());

    it('should resolve with the file contents', async () => {
      const promise = service.readSqlFile(new Blob(['ignored']) as File);

      lastFileReader().fireLoad('CREATE TABLE t();');

      await expectAsync(promise).toBeResolvedTo('CREATE TABLE t();');
    });

    it('should pass the file to readAsText', () => {
      const file = new Blob(['ignored']) as File;

      void service.readSqlFile(file);

      expect(lastFileReader().readAsTextCalledWith).toBe(file);
    });

    it('should resolve with undefined when the event has no target', async () => {
      const promise = service.readSqlFile(new Blob(['ignored']) as File);

      lastFileReader().fireLoad(undefined);

      await expectAsync(promise).toBeResolvedTo(undefined as unknown as string);
    });

    it('should reject when the reader errors', async () => {
      const promise = service.readSqlFile(new Blob(['ignored']) as File);
      const failure = { type: 'error' };

      lastFileReader().fireError(failure);

      await expectAsync(promise).toBeRejectedWith(failure as unknown as ProgressEvent<FileReader>);
    });
  });
});
