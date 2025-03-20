import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { Icon } from '@iconify/react'
import React from 'react'

interface SlackConfigErrorModalProps {
    isOpen: boolean;
    onClose: () => void;
    missingKeys: string[];
    onGoToSettings: () => void;
}

const SlackConfigErrorModal: React.FC<SlackConfigErrorModalProps> = ({
    isOpen,
    onClose,
    missingKeys,
    onGoToSettings
}) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalContent>
                <ModalHeader className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <Icon icon="logos:slack-icon" width={24} />
                        <span>Slack Configuration Required</span>
                    </div>
                </ModalHeader>
                <ModalBody>
                    <div className="text-center mb-2">
                        <div className="bg-warning-50 dark:bg-warning-900/20 text-warning p-3 rounded-lg mb-4 inline-flex mx-auto">
                            <Icon icon="lucide:alert-triangle" width={24} height={24} />
                        </div>
                    </div>

                    <p className="mb-4">
                        Slack integration requires Bot, User, and App tokens to be configured for each Slack agent individually. Please set up the following in Settings:
                    </p>

                    <div className="bg-default-50 p-3 rounded-lg mb-4">
                        <ul className="list-disc list-inside space-y-1">
                            {missingKeys.map(key => (
                                <li key={key} className="font-mono text-sm">{key}</li>
                            ))}
                        </ul>
                    </div>

                    <p className="text-sm text-default-500">
                        You&apos;ll need to create a Slack app at <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-primary underline">api.slack.com</a> and copy your Bot Token to PySpur.
                    </p>
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={onClose}>
                        Cancel
                    </Button>
                    <Button color="primary" onPress={onGoToSettings}>
                        Go to Settings
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default SlackConfigErrorModal;