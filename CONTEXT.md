# Monobungsia Context

This glossary names the operational evidence and state used across Monobungsia. It keeps logging, observability, and accountability terms precise when their rules differ.

## Language

**Observability Signal**:
An append oriented diagnostic measurement whose partial loss reduces operational visibility but must not change a business outcome. Application logs, access logs, spans, and metric buckets are Observability Signals.
_Avoid_: Signal data, telemetry data, logs

**Observability Control**:
State whose exactness determines an operational decision, evaluation, authorization, replay result, or benchmark interpretation. Loss or duplication can change what an operator or automated process does.
_Avoid_: Control data, observability metadata

**Audit Trail**:
An immutable accountability record written with a business mutation. It is not an Observability Signal and its write failure must remain visible to the business operation.
_Avoid_: Audit log, telemetry event

**Blind Spot**:
A time interval where Observability Signals were not stored or could not be read. Absence inside a Blind Spot never means zero activity or a healthy system.
_Avoid_: Empty result, zero data
