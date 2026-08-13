import { describe, expect, it } from 'vitest';
import { beautifyPayload } from '../web/src/payloadFormat';

describe('beautifyPayload', () => {
  it('indenta JSON válido', () => {
    expect(beautifyPayload('{"id":1,"active":true}')).toBe(`{
  "id": 1,
  "active": true
}`);
  });

  it('separa contratos compactos sin romper argumentos entre paréntesis', () => {
    expect(beautifyPayload('LoginRequest { email: string(email, max 320), password: string(max 256) }')).toBe(`LoginRequest {
  email: string(email, max 320),
  password: string(max 256)
}`);
  });

  it('ordena listas de campos inferidas', () => {
    expect(beautifyPayload('Usuario opcional { id, email, passwordHash, name, role, perfil }')).toBe(`Usuario opcional {
  id,
  email,
  passwordHash,
  name,
  role,
  perfil
}`);
  });
});
