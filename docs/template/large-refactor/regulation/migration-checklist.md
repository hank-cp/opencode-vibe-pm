# Large-Scale Refactoring Compatibility Checklist

## Interface Compatibility

- [ ] All legacy APIs remain available (via Adapter / Facade / @deprecated marks)
- [ ] No data loss or format errors when legacy APIs call new APIs
- [ ] Deprecation warnings output correctly (if enabled)
- [ ] New API behavior matches legacy API documentation (or docs have been updated)

## Data Compatibility

- [ ] Legacy data formats can be read normally
- [ ] New and old data formats can be converted bidirectionally
- [ ] Database migration scripts are reversible
- [ ] Config file format is compatible (or migration tool provided)

## Test Coverage

- [ ] All legacy API regression tests pass
- [ ] New API behavior tests pass
- [ ] Compatibility layer tests pass (legacy→new call path)
- [ ] Edge case tests pass (empty data, extreme values, concurrency)

## Migration Path

- [ ] Migration docs updated (steps, timeline, rollback plan)
- [ ] Callers notified (if external modules or teams are involved)
- [ ] Deprecation milestones marked (version number + estimated removal date)
