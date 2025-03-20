import React, { useState, useEffect } from 'react'
import {
    Card,
    CardBody,
    CardFooter,
    CardHeader,
    Input,
    Button,
    Chip,
    Tooltip,
} from '@heroui/react'
import { Icon } from '@iconify/react'
import { SlackAgent } from '@/utils/api'

interface AgentTokenManagerProps {
    agent: SlackAgent
    onTokenUpdated?: () => void
    onAlert?: (message: string, color: 'success' | 'danger' | 'warning' | 'default') => void
}

interface TokenStatus {
    type: string
    label: string
    masked: string
    lastUpdated: string | null
    exists: boolean
}

const AgentTokenManager: React.FC<AgentTokenManagerProps> = ({ agent, onTokenUpdated, onAlert }) => {
    const [botToken, setBotToken] = useState('')
    const [userToken, setUserToken] = useState('')
    const [appToken, setAppToken] = useState('')
    const [botTokenStatus, setBotTokenStatus] = useState<TokenStatus>({
        type: 'bot_token',
        label: 'Bot Token',
        masked: '',
        lastUpdated: null,
        exists: agent.has_bot_token
    })
    const [userTokenStatus, setUserTokenStatus] = useState<TokenStatus>({
        type: 'user_token',
        label: 'User Token',
        masked: '',
        lastUpdated: null,
        exists: agent.has_user_token
    })
    const [appTokenStatus, setAppTokenStatus] = useState<TokenStatus>({
        type: 'app_token',
        label: 'App Token',
        masked: '',
        lastUpdated: null,
        exists: agent.has_app_token || false
    })
    const [isLoading, setIsLoading] = useState(false)
    const [message, setMessage] = useState('')

    useEffect(() => {
        if (agent) {
            setBotTokenStatus(prev => ({
                ...prev,
                exists: agent.has_bot_token,
                lastUpdated: agent.last_token_update
            }))
            setUserTokenStatus(prev => ({
                ...prev,
                exists: agent.has_user_token,
                lastUpdated: agent.last_token_update
            }))
            setAppTokenStatus(prev => ({
                ...prev,
                exists: agent.has_app_token || false,
                lastUpdated: agent.last_token_update
            }))

            // If tokens exist, fetch their masked versions
            if (agent.has_bot_token) {
                fetchMaskedToken('bot_token')
            }
            if (agent.has_user_token) {
                fetchMaskedToken('user_token')
            }
            if (agent.has_app_token) {
                fetchMaskedToken('app_token')
            }
        }
    }, [agent])

    const fetchMaskedToken = async (tokenType: string) => {
        try {
            const response = await fetch(`/api/slack/agents/${agent.id}/tokens/${tokenType}`)
            if (response.ok) {
                const data = await response.json()

                if (tokenType === 'bot_token') {
                    setBotTokenStatus(prev => ({
                        ...prev,
                        masked: data.masked_token,
                        lastUpdated: data.updated_at
                    }))
                } else if (tokenType === 'app_token') {
                    setAppTokenStatus(prev => ({
                        ...prev,
                        masked: data.masked_token,
                        lastUpdated: data.updated_at
                    }))
                } else {
                    setUserTokenStatus(prev => ({
                        ...prev,
                        masked: data.masked_token,
                        lastUpdated: data.updated_at
                    }))
                }
            }
        } catch (error) {
            console.error(`Error fetching ${tokenType}:`, error)
            onAlert?.(`Failed to fetch ${tokenType}`, 'danger')
        }
    }

    const saveTokens = async () => {
        try {
            const requests = [];
            if (botToken.trim()) {
                requests.push(
                    fetch(`/api/slack/agents/${agent.id}/tokens/bot_token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: botToken })
                    })
                );
            }
            if (userToken.trim()) {
                requests.push(
                    fetch(`/api/slack/agents/${agent.id}/tokens/user_token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: userToken })
                    })
                );
            }
            if (appToken.trim()) {
                requests.push(
                    fetch(`/api/slack/agents/${agent.id}/tokens/app_token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: appToken })
                    })
                );
            }

            const responses = await Promise.all(requests);

            if (responses.every(res => res.ok)) {
                setMessage('Tokens saved successfully');
                onTokenUpdated?.();
            } else {
                setMessage('Failed to save some tokens');
            }
        } catch (error) {
            console.error('Error saving tokens:', error);
            setMessage('Error saving tokens');
        }
    }

    const deleteToken = async (tokenType: string) => {
        setIsLoading(true)
        try {
            const response = await fetch(`/api/slack/agents/${agent.id}/tokens/${tokenType}`, {
                method: 'DELETE',
            })

            if (response.ok) {
                // Update token status
                if (tokenType === 'bot_token') {
                    setBotTokenStatus(prev => ({
                        ...prev,
                        exists: false,
                        masked: '',
                        lastUpdated: null
                    }))
                } else if (tokenType === 'app_token') {
                    setAppTokenStatus(prev => ({
                        ...prev,
                        exists: false,
                        masked: '',
                        lastUpdated: null
                    }))
                } else {
                    setUserTokenStatus(prev => ({
                        ...prev,
                        exists: false,
                        masked: '',
                        lastUpdated: null
                    }))
                }

                onAlert?.(`${tokenType === 'bot_token' ? 'Bot' : tokenType === 'app_token' ? 'App' : 'User'} token deleted successfully`, 'success')
                onTokenUpdated?.()
            } else {
                const errorData = await response.json()
                onAlert?.(`Failed to delete token: ${errorData.detail}`, 'danger')
            }
        } catch (error) {
            console.error(`Error deleting ${tokenType}:`, error)
            onAlert?.(`Failed to delete ${tokenType}`, 'danger')
        } finally {
            setIsLoading(false)
        }
    }

    const formatDate = (dateString: string | null) => {
        if (!dateString) return ''
        const date = new Date(dateString)
        return date.toLocaleString()
    }

    const renderTokenSection = (
        tokenType: string,
        status: TokenStatus,
        tokenValue: string,
        setTokenValue: (value: string) => void
    ) => {
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <h3 className="text-medium font-medium">{status.label}</h3>
                    {status.exists ? (
                        <Chip color="success" size="sm">
                            Configured
                        </Chip>
                    ) : (
                        <Chip color="warning" size="sm">
                            Not Configured
                        </Chip>
                    )}
                </div>

                {status.exists ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="flex-1 rounded border border-default-200 p-2 font-mono text-small">
                                {status.masked}
                            </div>
                            <Tooltip content="Delete token">
                                <Button
                                    isIconOnly
                                    color="danger"
                                    variant="light"
                                    size="sm"
                                    onPress={() => deleteToken(tokenType)}
                                    isLoading={isLoading}
                                >
                                    <Icon icon="solar:trash-bin-trash-bold" width={20} />
                                </Button>
                            </Tooltip>
                        </div>
                        {status.lastUpdated && (
                            <p className="text-tiny text-default-500">
                                Last updated: {formatDate(status.lastUpdated)}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <Input
                            type="password"
                            label={`Enter ${status.label}`}
                            placeholder={`Paste ${status.label.toLowerCase()} here`}
                            value={tokenValue}
                            onChange={(e) => setTokenValue(e.target.value)}
                            variant="bordered"
                            size="sm"
                            startContent={<Icon icon="solar:key-minimalistic-bold" width={18} />}
                        />
                        <Button
                            color="primary"
                            size="sm"
                            onPress={() => saveTokens()}
                            isLoading={isLoading}
                            startContent={<Icon icon="solar:disk-bold" width={18} />}
                        >
                            Save Token
                        </Button>
                    </div>
                )}
            </div>
        )
    }

    return (
        <Card className="border border-default-200">
            <CardHeader className="flex items-center justify-between gap-2 pb-0">
                <div>
                    <h3 className="text-medium font-medium">Slack Tokens</h3>
                    <p className="text-tiny text-default-500">
                        Configure authentication tokens for this Slack agent
                    </p>
                </div>
                <Icon icon="logos:slack-icon" width={24} />
            </CardHeader>
            <CardBody className="space-y-6">
                {renderTokenSection('bot_token', botTokenStatus, botToken, setBotToken)}
                {renderTokenSection('user_token', userTokenStatus, userToken, setUserToken)}
                {renderTokenSection('app_token', appTokenStatus, appToken, setAppToken)}
            </CardBody>
            <CardFooter className="text-tiny text-default-500">
                <p>
                    <Icon icon="solar:info-circle-bold" className="mr-1" width={16} inline={true} />
                    Bot tokens start with <code>xoxb-</code>, User tokens start with <code>xoxp-</code>, and App tokens start with <code>xapp-</code>
                </p>
            </CardFooter>
            {message && (
                <CardFooter className="text-tiny text-default-500">
                    <p>{message}</p>
                </CardFooter>
            )}
        </Card>
    )
}

export default AgentTokenManager