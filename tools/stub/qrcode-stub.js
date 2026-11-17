module.exports = { toDataURL: async t => 'data:image/png;base64,' + Buffer.from('QR:' + t).toString('base64') };
