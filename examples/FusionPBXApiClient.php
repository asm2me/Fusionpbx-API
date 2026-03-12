<?php
/**
 * FusionPBX API Bridge — PHP Client
 * REST API wrapper for server-to-server CRM integration.
 *
 * Usage:
 *   $api = new FusionPBXApiClient('https://pbx.company.com', 'your-api-key');
 *   $calls = $api->getActiveCalls('company.com');
 */

class FusionPBXApiClient
{
    private string $baseUrl;
    private string $apiKey;
    private int    $timeout;

    public function __construct(string $baseUrl, string $apiKey, int $timeout = 10)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->apiKey  = $apiKey;
        $this->timeout = $timeout;
    }

    // ── Call Control ──────────────────────────────────────────────────────────

    /**
     * Originate an outbound call.
     * @param string $from      Extension to call first (agent's phone)
     * @param string $to        Destination number
     * @param string $domain    FusionPBX domain
     * @param string $callerId  Caller ID number shown to destination
     * @param string $callerName Caller ID name shown to destination
     * @param int    $timeout   Ring timeout in seconds
     */
    public function originateCall(
        string $from,
        string $to,
        string $domain,
        string $callerId  = '',
        string $callerName = '',
        int    $timeout   = 30
    ): array {
        return $this->post('/api/calls/originate', [
            'from'       => $from,
            'to'         => $to,
            'domain'     => $domain,
            'callerId'   => $callerId,
            'callerName' => $callerName,
            'timeout'    => $timeout,
        ]);
    }

    public function hangupCall(string $uuid, string $cause = 'NORMAL_CLEARING'): array
    {
        return $this->post("/api/calls/{$uuid}/hangup", ['cause' => $cause]);
    }

    public function holdCall(string $uuid): array
    {
        return $this->post("/api/calls/{$uuid}/hold");
    }

    public function unholdCall(string $uuid): array
    {
        return $this->post("/api/calls/{$uuid}/unhold");
    }

    public function toggleHold(string $uuid): array
    {
        return $this->post("/api/calls/{$uuid}/hold/toggle");
    }

    public function transferCall(string $uuid, string $destination, string $domain, string $type = 'blind'): array
    {
        return $this->post("/api/calls/{$uuid}/transfer", [
            'destination' => $destination,
            'domain'      => $domain,
            'type'        => $type, // 'blind' or 'attended'
        ]);
    }

    public function muteCall(string $uuid): array
    {
        return $this->post("/api/calls/{$uuid}/mute");
    }

    public function unmuteCall(string $uuid): array
    {
        return $this->post("/api/calls/{$uuid}/unmute");
    }

    public function sendDtmf(string $uuid, string $digits): array
    {
        return $this->post("/api/calls/{$uuid}/dtmf", ['digits' => $digits]);
    }

    // ── Call Info ─────────────────────────────────────────────────────────────

    public function getActiveCalls(string $domain = ''): array
    {
        $q = $domain ? "?domain={$domain}" : '';
        return $this->get("/api/calls/active{$q}");
    }

    public function getChannels(string $domain = ''): array
    {
        $q = $domain ? "?domain={$domain}" : '';
        return $this->get("/api/calls/channels{$q}");
    }

    public function getChannel(string $uuid): array
    {
        return $this->get("/api/calls/channels/{$uuid}");
    }

    public function getEslStatus(): array
    {
        return $this->get('/api/calls/esl/status');
    }

    // ── CDR ───────────────────────────────────────────────────────────────────

    public function getCdr(array $params = []): array
    {
        return $this->get('/api/cdr?' . http_build_query($params));
    }

    public function getCdrRecord(string $uuid): array
    {
        return $this->get("/api/cdr/{$uuid}");
    }

    public function getCdrStats(array $params = []): array
    {
        return $this->get('/api/cdr/stats/summary?' . http_build_query($params));
    }

    // ── Extensions & Domains ─────────────────────────────────────────────────

    public function getExtensions(string $domain = ''): array
    {
        $q = $domain ? "?domain={$domain}" : '';
        return $this->get("/api/extensions{$q}");
    }

    public function getExtension(string $ext, string $domain = ''): array
    {
        $q = $domain ? "?domain={$domain}" : '';
        return $this->get("/api/extensions/{$ext}{$q}");
    }

    public function getRegistrations(string $domain = ''): array
    {
        $q = $domain ? "?domain={$domain}" : '';
        return $this->get("/api/extensions/registrations{$q}");
    }

    public function getDomains(): array
    {
        return $this->get('/api/domains');
    }

    // ── Status ────────────────────────────────────────────────────────────────

    public function getStatus(): array
    {
        return $this->get('/api/status');
    }

    public function getDetailedStatus(): array
    {
        return $this->get('/api/status/detailed');
    }

    // ── JWT Auth ──────────────────────────────────────────────────────────────

    public function getJwtToken(string $domain = ''): array
    {
        return $this->post('/api/auth/token', [
            'api_key' => $this->apiKey,
            'domain'  => $domain,
        ]);
    }

    // ── HTTP Helpers ──────────────────────────────────────────────────────────

    private function get(string $path): array
    {
        return $this->request('GET', $path);
    }

    private function post(string $path, array $body = []): array
    {
        return $this->request('POST', $path, $body);
    }

    private function request(string $method, string $path, array $body = []): array
    {
        $url = $this->baseUrl . $path;
        $ch  = curl_init($url);

        $headers = [
            'X-API-Key: ' . $this->apiKey,
            'Content-Type: application/json',
            'Accept: application/json',
        ];

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeout,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error    = curl_error($ch);
        curl_close($ch);

        if ($error) {
            return ['error' => $error, 'http_code' => 0];
        }

        $data = json_decode($response, true) ?? ['raw' => $response];
        $data['http_code'] = $httpCode;
        return $data;
    }
}
