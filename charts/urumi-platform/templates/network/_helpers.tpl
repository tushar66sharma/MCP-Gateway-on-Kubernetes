{{/* Private and special-use ranges that "internet" egress rules must never reach (SSRF, cloud metadata,
     node and pod networks). In-cluster destinations are allowed only through explicit selectors. */}}
{{- define "urumi.privateRanges" -}}
- 10.0.0.0/8
- 172.16.0.0/12
- 192.168.0.0/16
- 169.254.0.0/16
- 100.64.0.0/10
- 127.0.0.0/8
{{- end }}

{{/* Egress rule to the public internet on 443 and 80. */}}
{{- define "urumi.internetEgress" -}}
- to:
    - ipBlock:
        cidr: 0.0.0.0/0
        except:
          {{- include "urumi.privateRanges" . | nindent 10 }}
  ports:
    - { protocol: TCP, port: 443 }
    - { protocol: TCP, port: 80 }
{{- end }}

{{/* Ingress source: the k3s Traefik pods. */}}
{{- define "urumi.fromTraefik" -}}
- from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
      podSelector:
        matchLabels:
          app.kubernetes.io/name: traefik
{{- end }}
