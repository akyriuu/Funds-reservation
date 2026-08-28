# Hold-System

> 🇧🇷 [Leia em português](#sistema-de-segurança)

A focused API for **funds reservation** — reserve money now, decide later whether it actually moves.

---

## What it is

Hold-System implements the authorization hold primitive found in every payment
processor. Money is split into three views of the same balance:

```
Ledger balance:    R$ 1.000   ← what the account owns
Available balance: R$   700   ← what can still be committed
Reserved balance:  R$   300   ← locked by an active hold
```

Once reserved, a hold resolves in exactly one of three ways:

```
RESERVE
   │
   ├── CAPTURE → funds actually move out
   ├── RELEASE → funds return to available
   └── EXPIRE  → hold times out and funds return automatically
```

Capture may be **partial**: authorize R$ 100, capture R$ 80, and the remaining
R$ 20 returns to available immediately.

---

## The problem it solves

The domain is trivial to describe and hard to get right, because every
operation is a race condition waiting to happen:

```
Available: R$ 1.000

Request A → reserve R$ 800
Request B → reserve R$ 800
```

Both requests read a sufficient balance. Both pass validation. Only one may be
approved. The naive `SELECT` → check → `UPDATE` sequence approves both and
leaves the account at −R$ 600.

The same class of bug appears everywhere else in the flow: two `capture` calls
racing on the same hold, a `capture` arriving exactly as the expiration worker
sweeps, a client retrying a `reserve` after a network timeout, or two worker
instances expiring the same hold twice.

This project exists to solve those, and to **prove** they are solved: 9
integration tests fire genuinely concurrent operations against a real
PostgreSQL instance and assert exact final balances.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | NestJS 11 |
| ORM | Prisma 7 with the `@prisma/adapter-pg` driver adapter |
| Database | PostgreSQL 17 |
| Scheduling | `@nestjs/schedule` |
| Testing | Jest + Testcontainers |

PostgreSQL is not interchangeable here. The design depends on real row-level
locking and `SELECT ... FOR UPDATE SKIP LOCKED`.

---

## Design decisions

### Conditional atomic updates instead of read-then-write

`availableCents` is a materialized column, which lets a reservation be
expressed as a single guarded statement:

```ts
const account = await tx.account.update({
  where: { id: accountId, availableCents: { gte: amountCents } },
  data: {
    availableCents: { decrement: amountCents },
    reservedCents:  { increment: amountCents },
  },
});
```

Under `READ COMMITTED`, when this `UPDATE` meets a row locked by a concurrent
transaction it blocks, then **re-evaluates the `WHERE` against the committed
row version**. There is no window between reading and writing, because there is
no separate read.

This was chosen over `SELECT ... FOR UPDATE` (an extra round trip) and over
optimistic locking with a `version` column (retry storms precisely on the
busiest accounts).

### Compare-and-swap on hold status

Settlement claims the hold atomically before any money moves:

```ts
const hold = await tx.hold.update({
  where: { id, status: 'PENDING', expiresAt: { gt: now } },
  data:  { status: 'CAPTURED', capturedCents, settledAt: now },
});
```

Two concurrent captures: one matches, the other raises `P2025` and becomes a
`409`. Capture racing release: same outcome. Double capture is structurally
impossible, not defended against.

### Logical expiration, asynchronous reconciliation

Note the `expiresAt: { gt: now }` above. A hold becomes uncapturable **the
instant it expires**, regardless of whether the worker has run. The scheduled
job is demoted to a reconciler whose only job is returning `reserved` funds to
`available`.

If the worker lags five minutes, the worst symptom is money reserved five
minutes too long — never an improper capture.

### Consistent lock ordering

Every write path touches `Hold` before `Account`: reserve, capture, release,
and the expiration sweep. Uniform lock acquisition order is what makes deadlock
between these operations impossible.

### Two layers of idempotency

`reserve` relies on a unique index on `Hold.idempotencyKey`, which commits in
the *same transaction* that moves the balance. Concurrent duplicate requests
serialize on the index itself: the second blocks on `INSERT`, receives a unique
violation, and replays the original hold.

`capture` and `release` additionally use a generic `IdempotencyRecord` table
that stores and replays the original response. This is ergonomics rather than
correctness — the CAS already prevents double execution; the record just
returns the same `200` instead of a confusing `409` on retry.

### Invariants enforced by the database

The service layer is not trusted as the last line of defense:

```sql
CHECK ("availableCents" >= 0)
CHECK ("balanceCents" = "availableCents" + "reservedCents")
CHECK ("capturedCents" >= 0 AND "capturedCents" <= "amountCents")
```

A partial index on `("expiresAt") WHERE status = 'PENDING'` keeps the
expiration sweep proportional to the live queue rather than to total history.

### Money as `BigInt` cents

No floats, no `Decimal`. All balance arithmetic is integer addition, so
rounding error cannot exist. The HTTP layer converts to `number` in explicit
presenters — there is exactly one serialization path.

### Domain errors, not HTTP exceptions

Services raise `InsufficientFundsError`, `HoldExpiredError`, and friends. A
single exception filter maps them to status codes. This is what allows the
concurrency tests to call services directly and assert on error types instead
of parsing HTTP responses.

---

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/accounts` | Create an account |
| `GET` | `/accounts/:id` | Ledger, available and reserved balances |
| `POST` | `/accounts/:id/deposits` | Credit funds |
| `GET` | `/accounts/:id/ledger` | Append-only statement |
| `POST` | `/holds` | Reserve funds — requires `Idempotency-Key` |
| `GET` | `/holds/:id` | Inspect a hold |
| `POST` | `/holds/:id/capture` | Capture, fully or partially |
| `POST` | `/holds/:id/release` | Release back to available |

---

## Running

```bash
npm install
docker compose up -d
npx prisma migrate dev
npm run start:dev
```

```bash
ACCOUNT=$(curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" -d '{}' \
  | sed -E 's/.*"id":"([^"]+)".*/\1/')

curl -s -X POST "http://localhost:3000/accounts/$ACCOUNT/deposits" \
  -H "Content-Type: application/json" -d '{"amountCents":100000}'

BODY="{\"accountId\":\"$ACCOUNT\",\"amountCents\":80000}"

curl -s -X POST http://localhost:3000/holds -H "Content-Type: application/json" \
  -H "Idempotency-Key: req-a" -d "$BODY" &
curl -s -X POST http://localhost:3000/holds -H "Content-Type: application/json" \
  -H "Idempotency-Key: req-b" -d "$BODY" &
wait
```

One succeeds, one returns `422 insufficient_funds`.

---

## Tests

```bash
npm run test:e2e
```

Testcontainers starts a throwaway PostgreSQL instance, applies the migrations
(constraints included), and tears it down afterwards. Your development database
is never touched.

What is proven:

- Two competing R$ 800 reservations against R$ 1.000 → exactly one approved
- Fifty competing reservations against ten slots → exactly ten approved, available lands on zero
- Ten concurrent captures on one hold → exactly one, balance debited once
- Capture racing release → exactly one wins
- Capture on a due hold while the worker is stopped → rejected, hold untouched
- Three concurrent expiration sweeps over five due holds → each expired exactly once

Every test closes by asserting the invariants:
`balance = available + reserved`, and `reserved` equals the sum of live holds.

---
---

# Sistema de Segurança

> 🇺🇸 [Read in English](#hold-system)

Uma API focada em **reserva de fundos** — reservar dinheiro agora e decidir
depois se ele será efetivamente movimentado.

---

## O que é

O Sistema de Segurança implementa a primitiva de reserva presente em qualquer
processadora de pagamentos. O dinheiro é dividido em três visões do mesmo
saldo:

```
Saldo contábil:   R$ 1.000   ← o que a conta possui
Saldo disponível: R$   700   ← o que ainda pode ser comprometido
Saldo reservado:  R$   300   ← travado por uma reserva ativa
```

Uma vez reservado, o valor resolve de exatamente três formas:

```
RESERVE
   │
   ├── CAPTURE → o dinheiro é efetivamente movimentado
   ├── RELEASE → o dinheiro volta a ficar disponível
   └── EXPIRE  → a reserva expira e o valor retorna automaticamente
```

A captura pode ser **parcial**: autorize R$ 100, capture R$ 80, e os R$ 20
restantes voltam para o disponível na hora.

---

## O problema que resolve

O domínio é trivial de descrever e difícil de acertar, porque cada operação é
uma condição de corrida esperando para acontecer:

```
Disponível: R$ 1.000

Request A → reservar R$ 800
Request B → reservar R$ 800
```

As duas leem saldo suficiente. As duas passam na validação. Só uma pode ser
aprovada. A sequência ingênua de `SELECT` → verificar → `UPDATE` aprova ambas e
deixa a conta em −R$ 600.

A mesma classe de bug aparece no resto do fluxo: duas capturas disputando a
mesma reserva, uma captura chegando exatamente quando o expirador varre, um
cliente reenviando um `reserve` após timeout de rede, ou duas instâncias do
worker expirando a mesma reserva duas vezes.

Este projeto existe para resolver esses casos e para **provar** que estão
resolvidos: 9 testes de integração disparam operações genuinamente concorrentes
contra um PostgreSQL real e conferem os saldos finais exatos.

---

## Stack

| Camada | Escolha |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | NestJS 11 |
| ORM | Prisma 7 com o driver adapter `@prisma/adapter-pg` |
| Banco | PostgreSQL 17 |
| Agendamento | `@nestjs/schedule` |
| Testes | Jest + Testcontainers |

O PostgreSQL não é intercambiável aqui. O desenho depende de lock de linha real
e de `SELECT ... FOR UPDATE SKIP LOCKED`.

---

## Decisões de projeto

### Update condicional atômico em vez de ler-depois-escrever

`availableCents` é uma coluna materializada, o que permite expressar a reserva
como uma única instrução com guarda:

```ts
const account = await tx.account.update({
  where: { id: accountId, availableCents: { gte: amountCents } },
  data: {
    availableCents: { decrement: amountCents },
    reservedCents:  { increment: amountCents },
  },
});
```

Sob `READ COMMITTED`, quando esse `UPDATE` encontra uma linha travada por outra
transação ele bloqueia e então **reavalia o `WHERE` contra a versão commitada
da linha**. Não existe janela entre ler e escrever, porque não existe leitura
separada.

Foi escolhido no lugar de `SELECT ... FOR UPDATE` (um round trip a mais) e do
lock otimista com coluna `version` (tempestade de retries justamente nas contas
mais movimentadas).

### Compare-and-swap no status da reserva

A liquidação reivindica a reserva atomicamente antes de qualquer dinheiro se
mexer:

```ts
const hold = await tx.hold.update({
  where: { id, status: 'PENDING', expiresAt: { gt: now } },
  data:  { status: 'CAPTURED', capturedCents, settledAt: now },
});
```

Duas capturas concorrentes: uma casa, a outra levanta `P2025` e vira `409`.
Captura disputando com liberação: mesmo resultado. Captura dupla é
estruturalmente impossível, não algo contra o que nos defendemos.

### Expiração lógica, reconciliação assíncrona

Repare no `expiresAt: { gt: now }` acima. Uma reserva se torna incapturável **no
instante em que vence**, independente do worker ter rodado. O job agendado é
rebaixado a reconciliador, cuja única função é devolver o valor reservado ao
disponível.

Se o worker atrasar cinco minutos, o pior sintoma é dinheiro reservado por
cinco minutos a mais — nunca uma captura indevida.

### Ordem de locks consistente

Todo caminho de escrita toca `Hold` antes de `Account`: reserve, capture,
release e a varredura de expiração. Ordem uniforme de aquisição de lock é o que
torna deadlock entre essas operações impossível.

### Duas camadas de idempotência

O `reserve` se apoia no índice único em `Hold.idempotencyKey`, que commita na
*mesma transação* que move o saldo. Requisições duplicadas concorrentes se
serializam no próprio índice: a segunda bloqueia no `INSERT`, recebe violação
de unicidade e replica a reserva original.

`capture` e `release` usam adicionalmente uma tabela genérica
`IdempotencyRecord`, que armazena e reproduz a resposta original. Isso é
ergonomia, não correção — o CAS já impede execução dupla; o registro apenas
devolve o mesmo `200` em vez de um `409` confuso no retry.

### Invariantes garantidas pelo banco

A camada de serviço não é tratada como última linha de defesa:

```sql
CHECK ("availableCents" >= 0)
CHECK ("balanceCents" = "availableCents" + "reservedCents")
CHECK ("capturedCents" >= 0 AND "capturedCents" <= "amountCents")
```

Um índice parcial em `("expiresAt") WHERE status = 'PENDING'` mantém a varredura
de expiração proporcional à fila viva, não ao histórico total.

### Dinheiro como `BigInt` de centavos

Sem float, sem `Decimal`. Toda a aritmética de saldo é soma de inteiros, então
erro de arredondamento não pode existir. A camada HTTP converte para `number`
em presenters explícitos — existe exatamente um caminho de serialização.

### Erros de domínio, não exceções HTTP

Os serviços lançam `InsufficientFundsError`, `HoldExpiredError` e afins. Um
único filtro de exceção os mapeia para códigos de status. É isso que permite aos
testes de concorrência chamar os serviços diretamente e afirmar sobre tipos de
erro, em vez de interpretar respostas HTTP.

---

## API

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/accounts` | Cria uma conta |
| `GET` | `/accounts/:id` | Saldos contábil, disponível e reservado |
| `POST` | `/accounts/:id/deposits` | Credita fundos |
| `GET` | `/accounts/:id/ledger` | Extrato append-only |
| `POST` | `/holds` | Reserva fundos — exige `Idempotency-Key` |
| `GET` | `/holds/:id` | Consulta uma reserva |
| `POST` | `/holds/:id/capture` | Captura, total ou parcial |
| `POST` | `/holds/:id/release` | Libera de volta ao disponível |

---

## Executando

```bash
npm install
docker compose up -d
npx prisma migrate dev
npm run start:dev
```

```bash
ACCOUNT=$(curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" -d '{}' \
  | sed -E 's/.*"id":"([^"]+)".*/\1/')

curl -s -X POST "http://localhost:3000/accounts/$ACCOUNT/deposits" \
  -H "Content-Type: application/json" -d '{"amountCents":100000}'

BODY="{\"accountId\":\"$ACCOUNT\",\"amountCents\":80000}"

curl -s -X POST http://localhost:3000/holds -H "Content-Type: application/json" \
  -H "Idempotency-Key: req-a" -d "$BODY" &
curl -s -X POST http://localhost:3000/holds -H "Content-Type: application/json" \
  -H "Idempotency-Key: req-b" -d "$BODY" &
wait
```

Uma passa, a outra retorna `422 insufficient_funds`.

---

## Testes

```bash
npm run test:e2e
```

O Testcontainers sobe um PostgreSQL descartável, aplica as migrations (com as
constraints incluídas) e derruba tudo ao final. Seu banco de desenvolvimento
nunca é tocado.

O que fica provado:

- Duas reservas de R$ 800 disputando R$ 1.000 → exatamente uma aprovada
- Cinquenta reservas disputando dez vagas → exatamente dez aprovadas, disponível zera
- Dez capturas concorrentes na mesma reserva → exatamente uma, saldo debitado uma vez
- Captura disputando com liberação → exatamente uma vence
- Captura de uma reserva vencida com o worker parado → rejeitada, reserva intacta
- Três varreduras concorrentes sobre cinco reservas vencidas → cada uma expirada uma única vez

Todo teste termina afirmando as invariantes:
`contábil = disponível + reservado`, e `reservado` igual à soma das reservas vivas.