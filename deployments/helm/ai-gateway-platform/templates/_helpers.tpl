{{/*
Expand the name of the chart.
*/}}
{{- define "ai-gateway-platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ai-gateway-platform.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "ai-gateway-platform.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ai-gateway-platform.labels" -}}
helm.sh/chart: {{ include "ai-gateway-platform.chart" . }}
app.kubernetes.io/name: {{ include "ai-gateway-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Gateway selector labels
*/}}
{{- define "ai-gateway-platform.gateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ai-gateway-platform.name" . }}-gateway
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: gateway
{{- end }}

{{/*
Control plane selector labels
*/}}
{{- define "ai-gateway-platform.controlPlane.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ai-gateway-platform.name" . }}-control-plane
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: control-plane
{{- end }}

{{/*
Database service name
*/}}
{{- define "ai-gateway-platform.databaseHost" -}}
{{- if .Values.database.internal.enabled -}}
{{ include "ai-gateway-platform.fullname" . }}-postgres
{{- else -}}
{{ .Values.database.external.host }}
{{- end -}}
{{- end }}

{{/*
Database port
*/}}
{{- define "ai-gateway-platform.databasePort" -}}
{{- if .Values.database.internal.enabled -}}
{{ .Values.database.internal.port }}
{{- else -}}
{{ .Values.database.external.port }}
{{- end -}}
{{- end }}

{{/*
Database name
*/}}
{{- define "ai-gateway-platform.databaseName" -}}
{{- if .Values.database.internal.enabled -}}
{{ .Values.database.internal.database }}
{{- else -}}
{{ .Values.database.external.database }}
{{- end -}}
{{- end }}

{{/*
Database user
*/}}
{{- define "ai-gateway-platform.databaseUser" -}}
{{- if .Values.database.internal.enabled -}}
{{ .Values.database.internal.user }}
{{- else -}}
{{ .Values.database.external.user }}
{{- end -}}
{{- end }}
