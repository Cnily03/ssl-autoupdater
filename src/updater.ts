import { QCloudSSLUpdater } from "@/updater/qcloud"
import { QiniuSSLUpdater } from "@/updater/qiniu"

/**
 * 证书更新器
 */
export const updater = {
    /**
     * 腾讯云
     */
    QCloud: QCloudSSLUpdater,
    /**
     * 七牛云
     */
    Qiniu: QiniuSSLUpdater,
};