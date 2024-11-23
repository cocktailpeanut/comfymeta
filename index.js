class Meta {
  get(files) {
    if (Array.isArray(files)) {
      let promises = files.map((file) => {
        return this._get(file)
      })
      return new Promise((resolve) => {
        Promise.all(promises).then((r) => {
          resolve(r)
        })
      })
    } else {
      return this._get(files)
    }
  }
  _get(file) {
    if (file.name.endsWith(".webp")) {
      return this.webp(file)
    } else if (file.name.endsWith(".png")) {
      return this.png(file)
    }
  }
  png(file) {
    return new Promise((r) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        let buffer = event.target.result

        // Get the PNG data as a Uint8Array
        const pngData = new Uint8Array(buffer)
        const dataView = new DataView(pngData.buffer)

        // Check that the PNG signature is present
        if (dataView.getUint32(0) !== 0x89504e47) {
          console.error('Not a valid PNG file')
          return
        }

        // Start searching for chunks after the PNG signature
        let offset = 8
        let txt_chunks = {}
        // Loop through the chunks in the PNG file
        while (offset < pngData.length) {
          // Get the length of the chunk
          const length = dataView.getUint32(offset)
          // Get the chunk type
          const type = String.fromCharCode(...pngData.slice(offset + 4, offset + 8))
          if (type === 'tEXt' || type == 'comf' || type === 'iTXt') {
            // Get the keyword
            let keyword_end = offset + 8
            while (pngData[keyword_end] !== 0) {
              keyword_end++
            }
            const keyword = String.fromCharCode(
              ...pngData.slice(offset + 8, keyword_end)
            )
            // Get the text
            const contentArraySegment = pngData.slice(
              keyword_end + 1,
              offset + 8 + length
            )
            const contentJson = new TextDecoder('utf-8').decode(contentArraySegment)
            txt_chunks[keyword] = contentJson
          }

          offset += 12 + length
        }
        r(txt_chunks)
      }
      reader.readAsArrayBuffer(file)
    })
  }
  flac(file) {
    return new Promise((r) => {
      const reader = new FileReader()
      reader.onload = function (event) {
        const buffer = event.target.result
        const dataView = new DataView(buffer)
        // Verify the FLAC signature
        const signature = String.fromCharCode(...new Uint8Array(buffer, 0, 4))
        if (signature !== 'fLaC') {
          console.error('Not a valid FLAC file')
          return
        }
        // Parse metadata blocks
        let offset = 4
        let vorbisComment = null
        while (offset < dataView.byteLength) {
          const isLastBlock = dataView.getUint8(offset) & 0x80
          const blockType = dataView.getUint8(offset) & 0x7f
          const blockSize = dataView.getUint32(offset, false) & 0xffffff
          offset += 4

          if (blockType === 4) {
            // Vorbis Comment block type
            vorbisComment = this.parseVorbisComment(
              new DataView(buffer, offset, blockSize)
            )
          }

          offset += blockSize
          if (isLastBlock) break
        }
        r(vorbisComment)
      }
      reader.readAsArrayBuffer(file)
    })
  }
  // Function to parse the Vorbis Comment block
  parseVorbisComment(dataView) {
    let offset = 0
    const vendorLength = dataView.getUint32(offset, true)
    offset += 4
    const vendorString = this.getString(dataView, offset, vendorLength)
    offset += vendorLength

    const userCommentListLength = dataView.getUint32(offset, true)
    offset += 4
    const comments = {}
    for (let i = 0; i < userCommentListLength; i++) {
      const commentLength = dataView.getUint32(offset, true)
      offset += 4
      const comment = this.getString(dataView, offset, commentLength)
      offset += commentLength

      const ind = comment.indexOf('=')
      const key = comment.substring(0, ind)

      comments[key] = comment.substring(ind + 1)
    }

    return comments
  }
  getString(dataView, offset, length) {
    let string = ''
    for (let i = 0; i < length; i++) {
      string += String.fromCharCode(dataView.getUint8(offset + i))
    }
    return string
  }
  parseExifData(exifData) {
    // Check for the correct TIFF header (0x4949 for little-endian or 0x4D4D for big-endian)
    const isLittleEndian = String.fromCharCode(...exifData.slice(0, 2)) === 'II'

    // Function to read 16-bit and 32-bit integers from binary data
    function readInt(offset, isLittleEndian, length) {
      let arr = exifData.slice(offset, offset + length)
      if (length === 2) {
        return new DataView(arr.buffer, arr.byteOffset, arr.byteLength).getUint16(
          0,
          isLittleEndian
        )
      } else if (length === 4) {
        return new DataView(arr.buffer, arr.byteOffset, arr.byteLength).getUint32(
          0,
          isLittleEndian
        )
      }
    }

    // Read the offset to the first IFD (Image File Directory)
    const ifdOffset = readInt(4, isLittleEndian, 4)

    function parseIFD(offset) {
      const numEntries = readInt(offset, isLittleEndian, 2)
      const result = {}

      for (let i = 0; i < numEntries; i++) {
        const entryOffset = offset + 2 + i * 12
        const tag = readInt(entryOffset, isLittleEndian, 2)
        const type = readInt(entryOffset + 2, isLittleEndian, 2)
        const numValues = readInt(entryOffset + 4, isLittleEndian, 4)
        const valueOffset = readInt(entryOffset + 8, isLittleEndian, 4)

        // Read the value(s) based on the data type
        let value
        if (type === 2) {
          // ASCII string
          value = new TextDecoder('utf-8').decode(
            exifData.subarray(valueOffset, valueOffset + numValues - 1)
          )
        }

        result[tag] = value
      }

      return result
    }

    // Parse the first IFD
    const ifdData = parseIFD(ifdOffset)
    return ifdData
  }
  webp(file) {
    return new Promise((r) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const webp = new Uint8Array(event.target.result)
        const dataView = new DataView(webp.buffer)

        // Check that the WEBP signature is present
        if (
          dataView.getUint32(0) !== 0x52494646 ||
          dataView.getUint32(8) !== 0x57454250
        ) {
          console.error('Not a valid WEBP file')
          r({})
          return
        }

        // Start searching for chunks after the WEBP signature
        let offset = 12
        let txt_chunks = {}
        // Loop through the chunks in the WEBP file
        while (offset < webp.length) {
          const chunk_length = dataView.getUint32(offset + 4, true)
          const chunk_type = String.fromCharCode(
            ...webp.slice(offset, offset + 4)
          )
          if (chunk_type === 'EXIF') {
            if (
              String.fromCharCode(...webp.slice(offset + 8, offset + 8 + 6)) ==
              'Exif\0\0'
            ) {
              offset += 6
            }
            let data = this.parseExifData(
              webp.slice(offset + 8, offset + 8 + chunk_length)
            )
            for (var key in data) {
              const value = data[key]
              if (typeof value === 'string') {
                const index = value.indexOf(':')
                txt_chunks[value.slice(0, index)] = value.slice(index + 1)
              }
            }
            break
          }

          offset += 8 + chunk_length
        }

        r(txt_chunks)
      }

      reader.readAsArrayBuffer(file)
    })
  }
}
